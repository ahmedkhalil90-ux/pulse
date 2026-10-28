import { doc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

const REFERRER = { uid: 'ref-holder', email: 'refholder@pulse.app' };
const NEWBIE = { uid: 'ref-newbie', email: 'refnewbie@pulse.app' };
const OTHER = { uid: 'ref-other', email: 'refother@pulse.app' };
const CODE = 'ABC123';

async function seedCode(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', REFERRER.uid), { username: 'holder', credits: 0, referralCode: CODE });
  await setDoc(doc(db, 'referralCodes', CODE), { uid: REFERRER.uid });
  await setDoc(doc(db, 'referralCodes', 'MINE01'), { uid: NEWBIE.uid });
}
const rec = (referrerUid: string, code = CODE) => ({ code, referrerUid, createdAt: '2026-10-28T00:00:00.000Z' });

/** referrals/{refereeUid}: recorded by the new user, credited by the server job. */
export const referralsCases: Case[] = [
  {
    name: 'a new user records who referred them',
    expect: 'allow',
    as: NEWBIE,
    seed: seedCode,
    run: (db) => setDoc(doc(db, 'referrals', NEWBIE.uid), rec(REFERRER.uid)),
  },
  {
    name: 'a referral naming someone other than the code holder is rejected',
    expect: 'deny',
    killedBy: 'M83',
    as: NEWBIE,
    seed: seedCode,
    run: (db) => setDoc(doc(db, 'referrals', NEWBIE.uid), rec(OTHER.uid)),
  },
  {
    name: 'a user cannot refer themselves with their own code',
    expect: 'deny',
    killedBy: 'M84',
    as: NEWBIE,
    seed: seedCode,
    run: (db) => setDoc(doc(db, 'referrals', NEWBIE.uid), rec(NEWBIE.uid, 'MINE01')),
  },
  {
    name: 'a referral cannot be recorded on behalf of another user',
    expect: 'deny',
    killedBy: 'M85',
    as: OTHER,
    seed: seedCode,
    run: (db) => setDoc(doc(db, 'referrals', NEWBIE.uid), rec(REFERRER.uid)),
  },
  {
    name: 'a recorded referral cannot be changed by the user',
    expect: 'deny',
    note: 'update is admin-only; no single guard to loosen.',
    as: NEWBIE,
    seed: async (ctx) => { await seedCode(ctx); await setDoc(doc(ctx.firestore(), 'referrals', NEWBIE.uid), rec(REFERRER.uid)); },
    run: (db) => setDoc(doc(db, 'referrals', NEWBIE.uid), rec(REFERRER.uid, 'ZZZ999')),
  },
];
