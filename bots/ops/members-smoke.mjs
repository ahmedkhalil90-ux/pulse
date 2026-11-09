#!/usr/bin/env node
/**
 * Runs the nightly members job (scripts/ops/members.mjs) twice against the
 * emulators and checks the outcome: numbers in join order with the founder
 * first, +5 paid exactly once at 100 answers, a Question of the Week picked
 * from members' questions only, and an abused invite link paused.
 * Prereqs: Firestore emulator on 8080, Auth emulator on 9099 (bots/run-all.sh).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const projectId = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-applet-config.json'), 'utf8')).projectId;
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

// A throwaway service key: the emulators accept any signature.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(os.tmpdir(), `pulse-smoke-sa-${process.pid}.json`);
fs.writeFileSync(keyFile, JSON.stringify({
  type: 'service_account', project_id: projectId, client_email: `smoke@${projectId}.iam.gserviceaccount.com`,
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
}));

const app = initializeApp({ credential: cert(keyFile), projectId });
const db = getFirestore(app);
const auth = getAuth(app);
const FOUNDER = 'WBoCq4ap0RUVfinJ2BeQvaFqUzj2'; // AK, member #1

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// --- seed -----------------------------------------------------------------
for (const c of ['users', 'user_answers', 'questions', 'results', 'counters', 'memberNumbers', 'referralCodes', 'referrals', 'waitlist', 'ops']) {
  const s = await db.collection(c).get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
}
await auth.listUsers(1000).then((r) => Promise.all(r.users.map((u) => auth.deleteUser(u.uid))));

// Accounts created in this order: early (12 answers), founder (2), late (11), lurker (3).
const accounts = [['early', 12], [FOUNDER, 2], ['late', 11], ['lurker', 3]];
for (const [uid, n] of accounts) {
  await auth.createUser({ uid, email: `${uid.slice(0, 8).toLowerCase()}@example.com` });
  await db.doc(`users/${uid}`).set({ credits: 0 });
  for (let i = 0; i < n; i++) await db.doc(`user_answers/${uid}_q${i}`).set({ userId: uid, questionId: `q${i}` });
  await new Promise((r) => setTimeout(r, 30));
}
// 101 more sign-ups through one link in the last day: abuse.
const batch = db.batch();
for (let i = 0; i < 101; i++) {
  batch.set(db.doc(`users/spam${i}`), { credits: 0 });
  batch.set(db.doc(`referrals/spam${i}`), { code: 'SPAMMY', referrerUid: 'early', createdAt: new Date().toISOString() });
}
await batch.commit();
await db.doc('referralCodes/SPAMMY').set({ uid: 'early' });

const q = (id, authorUid, a, b) => Promise.all([
  db.doc(`questions/${id}`).set({ text: id, options: ['x', 'y'], authorUid, status: 'live' }),
  db.doc(`results/${id}`).set({ counts: { '0': a, '1': b } }),
]);
await q('member100', 'late', 55, 50);       // reaches 100: reward + candidate
await q('member40', 'early', 20, 20);       // candidate, no reward
await q('system500', 'pulse_originals_system', 250, 250); // never question of the week

// --- run twice ------------------------------------------------------------
const env = { ...process.env, PULSE_SA_KEY: keyFile, GCLOUD_PROJECT: projectId };
const runJob = () => execFileSync('node', [path.join(ROOT, 'scripts/ops/members.mjs')], { cwd: os.tmpdir(), env, stdio: 'pipe' });
runJob();
const firstReport = fs.readFileSync(path.join(os.tmpdir(), 'members-report.md'), 'utf8');
runJob(); // a rerun must change nothing

// --- check ----------------------------------------------------------------
const num = async (uid) => (await db.doc(`users/${uid}`).get()).data().memberNumber;
check(await num(FOUNDER) === 1, 'founder is not #1');
check(await num('early') === 2, 'early member is not #2');
check(await num('late') === 3, 'late member is not #3');
check(!(await num('lurker')), 'a member with 3 answers got a number');
check((await db.doc('counters/members').get()).data().last === 3, 'counter does not match numbers issued');
check((await db.doc('memberNumbers/2').get()).data()?.uid === 'early', 'memberNumbers/2 does not point at its holder');

const late = (await db.doc('users/late').get()).data();
check(late.credits === 5, `+5 paid ${late.credits / 5} times, expected once`);
check(late.asker === true, 'Asker badge not set');
check(!!(await db.doc('questions/member100').get()).data().rewarded100At, 'reward not recorded on the question');
check((await db.doc('users/early').get()).data().credits === 0, 'a question under 100 answers was rewarded');

const qow = (await db.doc('ops/questionOfWeek').get()).data();
check(qow?.id === 'member100', `question of the week is ${qow?.id}, expected member100`);
check((await db.doc('referralCodes/SPAMMY').get()).data().paused === true, 'abused invite link not paused');
check(firstReport.includes('Paused for review'), 'report does not flag the paused link');

fs.rmSync(keyFile, { force: true });
console.log(`members job: ${fails.length ? fails.length + ' failed' : 'all checks passed'}`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
