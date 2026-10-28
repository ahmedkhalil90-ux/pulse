// One-off (run 2026-10-28): the 210 originals existed twice (Aug in-app seeder
// with random ids + seed_<id>). Keeps the copy with more votes, carries Arabic
// fields over, retires the other. Usage: node scripts/ops/dedupe.mjs [--dry-run]
import { readFileSync } from 'node:fs'; import { cert, initializeApp } from 'firebase-admin/app'; import { getFirestore } from 'firebase-admin/firestore';
const db = getFirestore(initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.PULSE_SA_KEY, 'utf8'))) }));
const DRY = process.argv.includes('--dry-run');
const s = await db.collection('questions').where('status', '==', 'live').get();
const by = {};
for (const d of s.docs) (by[d.data().text.trim().toLowerCase()] ??= []).push(d);
let kept = 0, retired = 0, movedVotes = 0;
const votes = async (id) => { const r = await db.doc(`results/${id}`).get(); const c = r.exists ? r.data().counts ?? {} : {}; return (c['0'] ?? 0) + (c['1'] ?? 0); };
for (const docs of Object.values(by)) {
  if (docs.length < 2) continue;
  const scored = await Promise.all(docs.map(async (d) => ({ d, v: await votes(d.id) })));
  scored.sort((a, b) => b.v - a.v || (a.d.id.startsWith('seed_') ? -1 : 1));
  const [keep, ...drop] = scored;
  const extra = {};
  for (const f of ['text_ar', 'options_ar', 'text_ar_gulf', 'options_ar_gulf', 'text_ar_eg', 'options_ar_eg'])
    if (!keep.d.data()[f]) { const src = drop.find((x) => x.d.data()[f]); if (src) extra[f] = src.d.data()[f]; }
  if (!DRY && Object.keys(extra).length) await keep.d.ref.update(extra);
  for (const x of drop) { if (x.v) movedVotes += x.v; if (!DRY) await x.d.ref.update({ status: 'retired', retireReason: `duplicate of ${keep.d.id}`, retiredAt: new Date().toISOString() }); retired++; }
  kept++;
}
console.log(`${DRY ? 'DRY: ' : ''}pairs ${kept}, retired ${retired}, votes on retired copies ${movedVotes}`);
process.exit(0);
