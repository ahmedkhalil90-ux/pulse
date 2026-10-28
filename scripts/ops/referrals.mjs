#!/usr/bin/env node
/**
 * Credits referrers. A new user records referrals/{uid} when they redeem a
 * code (their own +15 is applied then). This job gives the referrer their +15
 * once, in a transaction that also marks the referral credited, so a rerun can
 * never pay twice. Runs with the moderation schedule (every 8 hours).
 * Usage: PULSE_SA_KEY=<key.json> node scripts/ops/referrals.mjs
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const REFERRAL = 15;
const db = getFirestore(initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.PULSE_SA_KEY, 'utf8'))) }));
const open = await db.collection('referrals').where('credited', '==', false).limit(500).get()
  .then(async (s) => s.size ? s : db.collection('referrals').limit(500).get());
let credited = 0, skipped = 0;
for (const d of open.docs) {
  if (d.data().credited) continue;
  await db.runTransaction(async (tx) => {
    const ref = await tx.get(d.ref);
    if (ref.data()?.credited) { skipped++; return; }
    const referrer = db.doc(`users/${ref.data().referrerUid}`);
    if (!(await tx.get(referrer)).exists) { tx.update(d.ref, { credited: true, creditNote: 'referrer missing' }); skipped++; return; }
    tx.update(referrer, { credits: FieldValue.increment(REFERRAL) });
    tx.update(d.ref, { credited: true, creditedAt: new Date().toISOString() });
    credited++;
  });
}
console.log(`referrals: ${credited} referrers credited, ${skipped} skipped`);
process.exit(0);
