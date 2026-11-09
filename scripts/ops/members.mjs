#!/usr/bin/env node
/**
 * Nightly member jobs (Admin SDK). Idempotent: safe to rerun.
 *
 *  1. Member numbers: sets up counters/members, then numbers every member who
 *     has answered UNLOCK_ANSWERS questions but has none yet (the app claims
 *     its own at that point; this catches failures and accounts from before).
 *     Earliest account first; the founder is #1.
 *  2. +5 credits once a member's question reaches 100 answers, and the Asker
 *     badge. One transaction per question, so it can never pay twice.
 *  3. Question of the Week, chosen from members' own questions. The author is
 *     told privately in the app; nobody else learns who asked it.
 *  4. Invite links that brought in more than ABUSE_LIMIT sign-ups in a day are
 *     paused for review.
 *  5. Waitlist size (count only: addresses never leave Firestore).
 *
 * Writes members-report.md for the daily issue.
 * Usage: PULSE_SA_KEY=<key.json> node scripts/ops/members.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const UNLOCK_ANSWERS = 10;
const REWARD_AT = 100;
const REWARD = 5;
const ABUSE_LIMIT = 100;
const FOUNDER = 'WBoCq4ap0RUVfinJ2BeQvaFqUzj2'; // AK, member #1
const SYSTEM = new Set(['pulse_originals_system']);

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.PULSE_SA_KEY, 'utf8'))) });
const db = getFirestore(app);
const report = [];

// --- 1. member numbers -----------------------------------------------------
const users = await db.collection('users').get();
const counterRef = db.doc('counters/members');
if (!(await counterRef.get()).exists) {
  const max = Math.max(0, ...users.docs.map((u) => u.data().memberNumber || 0));
  await counterRef.set({ last: max });
}
const created = new Map();
let pageToken;
do {
  const page = await getAuth(app).listUsers(1000, pageToken);
  for (const u of page.users) created.set(u.uid, Date.parse(u.metadata.creationTime));
  pageToken = page.pageToken;
} while (pageToken);

const unnumbered = [];
for (const u of users.docs) {
  if (u.data().memberNumber) continue;
  const n = (await db.collection('user_answers').where('userId', '==', u.id).count().get()).data().count;
  if (n >= UNLOCK_ANSWERS || u.id === FOUNDER) unnumbered.push(u.id);
}
unnumbered.sort((a, b) => (a === FOUNDER ? -1 : b === FOUNDER ? 1 : (created.get(a) ?? Infinity) - (created.get(b) ?? Infinity)));
const assigned = [];
for (const uid of unnumbered) {
  const n = await db.runTransaction(async (tx) => {
    const [c, u] = [await tx.get(counterRef), await tx.get(db.doc(`users/${uid}`))];
    if (u.data()?.memberNumber) return null;
    const next = c.data().last + 1;
    tx.update(counterRef, { last: next });
    tx.set(db.doc(`memberNumbers/${next}`), { uid });
    tx.update(u.ref, { memberNumber: next });
    return next;
  });
  if (n) assigned.push(n);
}
const last = (await counterRef.get()).data().last;
report.push(`**Members:** ${users.size} accounts, ${last} with a member number${assigned.length ? ` (${assigned.length} assigned tonight)` : ''}.`);

// --- 2 & 3. rewards and Question of the Week --------------------------------
const userIds = new Set(users.docs.map((u) => u.id));
const live = await db.collection('questions').where('status', '==', 'live').get();
const memberQs = live.docs.filter((q) => userIds.has(q.data().authorUid) && !SYSTEM.has(q.data().authorUid));
let rewarded = 0;
const scored = [];
for (const q of memberQs) {
  const c = (await db.doc(`results/${q.id}`).get()).data()?.counts ?? {};
  const a = c['0'] ?? 0, b = c['1'] ?? 0, total = a + b;
  if (total >= 10) scored.push({ q, score: total * (0.5 + 0.5 * (1 - Math.abs(a - b) / total)) });
  if (total < REWARD_AT || q.data().rewarded100At) continue;
  const paid = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(q.ref);
    if (fresh.data().rewarded100At) return false;
    const author = db.doc(`users/${fresh.data().authorUid}`);
    if (!(await tx.get(author)).exists) return false;
    tx.update(author, { credits: FieldValue.increment(REWARD), asker: true });
    tx.update(q.ref, { rewarded100At: new Date().toISOString() });
    return true;
  });
  if (paid) rewarded++;
}
report.push(`**Askers:** ${memberQs.length} live member questions; ${rewarded} reached ${REWARD_AT} answers tonight (+${REWARD} credits each).`);

// The week is named by its Monday (UTC), e.g. "week of 2026-11-02".
const now = new Date();
const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
const qowRef = db.doc('ops/questionOfWeek');
const qow = (await qowRef.get()).data();
if (qow?.week === week) {
  report.push(`**Question of the Week** (week of ${week}) already chosen.`);
} else {
  const past = new Set(qow?.history ?? []);
  const pick = scored.filter((s) => !past.has(s.q.id)).sort((x, y) => y.score - x.score)[0];
  if (pick) {
    await qowRef.set({ id: pick.q.id, week, history: [...past, pick.q.id].slice(-52) });
    await pick.q.ref.update({ questionOfWeek: week });
    report.push(`**Question of the Week** (week of ${week}): "${pick.q.data().text}"`);
  } else {
    report.push(`**Question of the Week:** no member question has 10 answers yet.`);
  }
}

// --- 4. invite abuse --------------------------------------------------------
// Counted from the private referrals records: profiles do not keep the code.
const since = new Date(Date.now() - 864e5).toISOString();
const recent = (await db.collection('referrals').where('createdAt', '>=', since).get()).docs;
const byCode = {};
for (const r of recent) { const c = r.data().code; if (c) byCode[c] = (byCode[c] ?? 0) + 1; }
const paused = [];
for (const [code, n] of Object.entries(byCode)) {
  if (n <= ABUSE_LIMIT) continue;
  const ref = db.doc(`referralCodes/${code}`);
  if ((await ref.get()).data()?.paused) continue;
  await ref.update({ paused: true, pausedAt: new Date().toISOString(), pausedReason: `${n} sign-ups in 24h` });
  paused.push(`a link with ${n} sign-ups (code ending ${code.slice(-2)})`);
}
// Counts only: the repo and this report are public, and a code is a working invite.
const top = Object.values(byCode).sort((a, b) => b - a).slice(0, 3).map((n) => `${n}`).join(', ');
report.push(`**Invites:** ${recent.length} sign-ups in the last 24h${top ? ` (busiest links brought ${top})` : ''}.${paused.length ? ` ⚠️ Paused for review: ${paused.join(', ')}. Find it in Firestore under referralCodes (paused: true) and set paused to false to restore it.` : ''}`);

// --- 5. waitlist ------------------------------------------------------------
const waiting = (await db.collection('waitlist').count().get()).data().count;
report.push(`**Waitlist:** ${waiting} people waiting (addresses are in Firestore, collection \`waitlist\`).`);

const md = `\n### Members\n\n${report.join('\n\n')}\n`;
writeFileSync('members-report.md', md);
console.log(md);
process.exit(0);
