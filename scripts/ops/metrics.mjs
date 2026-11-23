#!/usr/bin/env node
/**
 * Beta metrics from activity/{uid}_{day} counts (scripts nothing about answers).
 * Writes ops/metrics and metrics-report.md for the daily GitHub report.
 * Usage: PULSE_SA_KEY=<key.json> node scripts/ops/metrics.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { answersPerVisit, funnel } from '../lib/funnel.mjs';

const db = getFirestore(initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.PULSE_SA_KEY, 'utf8'))) }));
const MIN_COHORT = 20; // below this, percentages are noise
const dayMs = 86400000;
const addDays = (d, n) => new Date(Date.parse(d) + n * dayMs).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

const rows = (await db.collection('activity').get()).docs.map((d) => d.data());
const byUser = new Map();
for (const r of rows) {
  const u = byUser.get(r.uid) ?? { days: new Map() };
  u.days.set(r.day, r);
  byUser.set(r.uid, u);
}
const first = (u) => [...u.days.keys()].sort()[0];

function retention(n) {
  const cohort = [...byUser.values()].filter((u) => addDays(first(u), n) < today); // day n is complete
  const back = cohort.filter((u) => u.days.has(addDays(first(u), n)));
  return { n: cohort.length, pct: cohort.length ? Math.round((back.length / cohort.length) * 100) : null };
}
function withinWeek() {
  const cohort = [...byUser.values()].filter((u) => addDays(first(u), 7) < today);
  const back = cohort.filter((u) => [...u.days.keys()].some((d) => d > first(u) && d <= addDays(first(u), 7)));
  return { n: cohort.length, pct: cohort.length ? Math.round((back.length / cohort.length) * 100) : null };
}

const activeDays = rows.filter((r) => (r.sessions ?? 0) + (r.answers ?? 0) > 0);
const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).reverse();
const dau = last7.map((d) => rows.filter((r) => r.day === d).length);
const signups = last7.map((d) => [...byUser.values()].filter((u) => first(u) === d).length);

const m = {
  when: new Date().toISOString(),
  users: byUser.size,
  d1: retention(1), d7: retention(7), d30: retention(30), week: withinWeek(),
  answersPerActiveDay: activeDays.length ? Number((sum('answers') / activeDays.length).toFixed(1)) : null,
  shareRate: sum('sessions') ? Math.round((sum('shares') / sum('sessions')) * 1000) / 10 : null,
  totals: { sessions: sum('sessions'), answers: sum('answers'), skips: sum('skips'), shares: sum('shares') },
  last7, dau, signups,
};
// Entry funnel, from every member's answer count (an aggregate query, about one
// read per member) and feature use. Only totals are stored and reported.
const GATES = { entry: 5, unlock: 10 }; // ENTRY_ANSWERS, UNLOCK_ANSWERS in src/lib/member.ts
const week = (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10); })();
const bracketUids = new Set((await db.collection('bracketPicks').select().get()).docs.map((d) => d.id.split('_')[0]));
const people = await Promise.all((await db.collection('users').get()).docs.map(async (u) => ({
  answers: (await db.collection('user_answers').where('userId', '==', u.id).count().get()).data().count,
  member: !!u.data().memberNumber,
  bracket: bracketUids.has(u.id),
  mind: (await u.ref.collection('private').doc('mind').get()).data()?.week === week,
})));
m.funnel = funnel(people, GATES);
m.answersPerVisit = answersPerVisit(m.totals.answers, m.totals.sessions);
await db.doc('ops/metrics').set(m);

const verdict = (x, target) => x.pct === null ? 'no data yet' : x.n < MIN_COHORT ? `${x.pct}% (only ${x.n} users, too early)` : `${x.pct}% ${x.pct >= target ? '✅' : '❌'}`;
const plain = (v, target, unit = '') => v === null ? 'no data yet' : `${v}${unit} ${v >= target ? '✅' : '❌'}`;
const md = [
  '', `**Beta metrics** (${m.users} users so far)`, '',
  '| Metric | Now | Target |', '|---|---|---|',
  `| Back the next day | ${verdict(m.d1, 40)} | ≥ 40% |`,
  `| Back on day 7 | ${verdict(m.d7, 20)} | ≥ 20% |`,
  `| Back within the first week | ${verdict(m.week, 35)} | ≥ 35% |`,
  `| Back on day 30 | ${verdict(m.d30, 10)} | ≥ 10% |`,
  `| Answers per active user per day | ${plain(m.answersPerActiveDay, 15)} | ≥ 15 |`,
  `| Sessions that end in a share | ${plain(m.shareRate, 5, '%')} | ≥ 5% |`,
  `| Answers per visit | ${plain(m.answersPerVisit, 8)} | ≥ 8 |`,
  '', `**Entry funnel** (all ${m.funnel.steps.signedUp.n} accounts)`, '',
  '| Step | Members | Share | Target |', '|---|---|---|---|',
  ...[['Signed up', 'signedUp', null], [`Reached ${GATES.entry} answers (app opens)`, 'opened', 80], [`Reached ${GATES.unlock} answers (invite link)`, 'unlocked', 60],
    ['Claimed a member number', 'member', 60], ['Played a Knockout bracket', 'knockout', 30], ['Used Mind Reader this week', 'mind', 15]]
    .map(([label, k, target]) => { const s = m.funnel.steps[k]; return `| ${label} | ${s.n} | ${s.pct === null ? '–' : `${s.pct}%`} | ${target === null ? '' : `≥ ${target}% ${s.pct === null || m.funnel.steps.signedUp.n < MIN_COHORT ? '' : s.pct >= target ? '✅' : '❌'}`} |`; }),
  m.funnel.biggestDrop ? `\nMost people are lost ${m.funnel.biggestDrop.where}: ${m.funnel.biggestDrop.lost} (${m.funnel.biggestDrop.pct}%).` : '',
  '', `Last 7 days (${last7[0]} to ${last7[6]}): daily active ${dau.join(' · ')}; new users ${signups.join(' · ')}.`,
].join('\n');
writeFileSync('metrics-report.md', md);
console.log(md);
process.exit(0);
