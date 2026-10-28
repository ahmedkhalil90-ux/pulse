/**
 * Nightly question ranking (runs in GitHub Actions, see .github/workflows/daily-ops.yml).
 *
 * For every live public question:
 *   answers  = results/{id} counts       skips = skipped_questions count
 *   engage   = smoothed answer share of (answers + skips)      prior 7/10
 *   balance  = how close the split is to 50/50, smoothed        prior 0.6 over 5
 *   rank     = 0.6 engage + 0.4 balance - flag penalty, clamped 0..1
 * Tiers among questions with >= JUDGE_AT responses: top 20% 'top', bottom 20%
 * 'low', bottom 5% retired (status 'retired'); fewer responses = 'exploring'.
 * Expired trend questions are retired. When fewer than EXPLORING_TARGET
 * questions are exploring, questions waiting in the pool (status 'pool',
 * written by the daily AI bot) are promoted to live.
 *
 * Only aggregate counts are read. Usage: npx tsx scripts/ops/rank.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry-run');
const JUDGE_AT = 50, RETIRE_PCT = 0.05, LOW_PCT = 0.2, TOP_PCT = 0.2, EXPLORING_TARGET = 30;

const key = JSON.parse(readFileSync(process.env.PULSE_SA_KEY ?? path.resolve('.secrets/service-account.json'), 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }));

export function score(a0: number, a1: number, skips: number, flags: number) {
  const answers = a0 + a1, n = answers + skips;
  const engage = (answers + 7) / (n + 10);
  const bal = answers ? 1 - Math.abs(a0 / answers - 0.5) * 2 : 0.6;
  const balance = (bal * answers + 0.6 * 5) / (answers + 5);
  const flagPenalty = Math.min(1, flags / Math.max(5, n * 0.1));
  return { n, rank: Math.max(0, Math.min(1, 0.6 * engage + 0.4 * balance - 0.5 * flagPenalty)) };
}

async function main() {
  const now = new Date().toISOString();
  const live = await db.collection('questions').where('status', '==', 'live').where('isPublic', '==', true).get();
  const rows: Array<{ id: string; n: number; rank: number; prev: any; expired: boolean }> = [];
  for (const d of live.docs) {
    const q = d.data();
    const [res, skips] = await Promise.all([
      db.doc(`results/${d.id}`).get(),
      db.collection('skipped_questions').where('questionId', '==', d.id).count().get(),
    ]);
    const c = res.exists ? res.data()!.counts ?? {} : {};
    const s = score(c['0'] ?? 0, c['1'] ?? 0, skips.data().count, q.flags ?? 0);
    rows.push({ id: d.id, ...s, prev: q, expired: !!q.expiresAt && q.expiresAt < now });
  }

  const judged = rows.filter((r) => r.n >= JUDGE_AT).sort((a, b) => a.rank - b.rank);
  const cut = (p: number) => Math.floor(judged.length * p);
  const retire = new Set(judged.slice(0, cut(RETIRE_PCT)).map((r) => r.id));
  const low = new Set(judged.slice(0, cut(LOW_PCT)).map((r) => r.id));
  const top = new Set(judged.slice(judged.length - cut(TOP_PCT)).map((r) => r.id));

  const stats = { live: rows.length, top: 0, normal: 0, low: 0, exploring: 0, retired: 0, expired: 0, evergreen: 0, promoted: 0, changed: 0 };
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !DRY) await batch.commit(); batch = db.batch(); ops = 0; };
  for (const r of rows) {
    const ref = db.doc(`questions/${r.id}`);
    // A trend that reached the top tier has proven itself beyond its moment:
    // keep it as a permanent question instead of expiring it.
    if (r.expired && top.has(r.id)) {
      stats.evergreen++; stats.top++; stats.changed++;
      batch.update(ref, { expiresAt: FieldValue.delete(), evergreen: true, rank: Number(r.rank.toFixed(4)), rankN: r.n, rankTier: 'top', rankUpdatedAt: now });
      if (++ops >= 400) await flush();
      continue;
    }
    if (r.expired || retire.has(r.id)) {
      r.expired ? stats.expired++ : stats.retired++;
      batch.update(ref, { status: 'retired', retiredAt: now, retireReason: r.expired ? 'trend expired' : 'bottom 5% by rank' });
    } else {
      const tier = r.n < JUDGE_AT ? 'exploring' : top.has(r.id) ? 'top' : low.has(r.id) ? 'low' : 'normal';
      stats[tier]++;
      if (r.prev.rankTier === tier && Math.abs((r.prev.rank ?? -1) - r.rank) < 0.005) continue;
      batch.update(ref, { rank: Number(r.rank.toFixed(4)), rankN: r.n, rankTier: tier, rankUpdatedAt: now });
    }
    stats.changed++;
    if (++ops >= 400) await flush();
  }
  await flush();

  // Keep a steady stream of new questions in the exploring slot.
  const need = EXPLORING_TARGET - stats.exploring;
  if (need > 0) {
    const pool = await db.collection('questions').where('status', '==', 'pool').orderBy('createdAt', 'desc').limit(need).get();
    for (const d of pool.docs) {
      if (!DRY) await d.ref.update({ status: 'live', rankTier: 'exploring', promotedAt: now, random: Math.random() });
      stats.promoted++;
    }
  }
  const poolLeft = (await db.collection('questions').where('status', '==', 'pool').count().get()).data().count;

  // Compact index of live questions for the app's duplicate check at
  // submission time: one document read instead of hundreds.
  const index = (await db.collection('questions').where('status', '==', 'live').where('isPublic', '==', true).select('text', 'options').get())
    .docs.map((d) => ({ id: d.id, t: d.data().text, o: d.data().options }));
  if (!DRY) await db.doc('ops/questionIndex').set({ items: index, updatedAt: now });

  const report = { when: now, dryRun: DRY, ...stats, poolLeft, best: judged.slice(-5).reverse().map((r) => r.prev.text), worst: judged.slice(0, 5).map((r) => r.prev.text) };
  console.log(JSON.stringify(report, null, 1));
  writeFileSync('rank-report.json', JSON.stringify(report, null, 1));
  if (!DRY) await db.doc('ops/rank').set({ ...report, updatedAt: FieldValue.serverTimestamp() });
  process.exit(0);
}

if (process.argv[1]?.endsWith('rank.ts')) main().catch((e) => { console.error(e); process.exit(1); });
