import { doc, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';
import { INVITE, seedInvite } from '../helpers/fixtures';

/** Daily streaks, streak freezes, Mind Reader score, bracket reports. */
const M = { uid: 'en-member', email: 'en@example.com' };
const OTHER = { uid: 'en-other', email: 'en2@example.com' };
const day = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

const seed = (extra: Record<string, unknown> = {}) => async (ctx: RulesTestContext) => {
  await setDoc(doc(ctx.firestore(), 'users', M.uid), { credits: 20, lastLogin: day(-1), streak: 5, demographics: {}, ...extra });
};
/** The app's daily check-in: +3, lastLogin -> today, streak, reason. */
function checkIn(db: any, fields: Record<string, unknown>) {
  const b = writeBatch(db);
  b.update(doc(db, 'users', M.uid), { credits: increment(3), lastLogin: day(), ...fields });
  b.set(doc(db, 'users', M.uid, 'private', 'credit'), { reason: 'daily', ref: '', at: serverTimestamp() });
  return b.commit();
}
function buyFreeze(db: any) {
  const b = writeBatch(db);
  b.update(doc(db, 'users', M.uid), { credits: increment(-5), freezes: increment(1) });
  b.set(doc(db, 'users', M.uid, 'private', 'credit'), { reason: 'freeze', ref: '', at: serverTimestamp() });
  return b.commit();
}
const mind = (db: any) => doc(db, 'users', M.uid, 'private', 'mind');
const seedMind = async (ctx: RulesTestContext) => { await setDoc(doc(ctx.firestore(), 'users', M.uid, 'private', 'mind'), { week: '2026-11-16', right: 3, total: 5 }); };
const seedBracket = async (ctx: RulesTestContext) => { await setDoc(doc(ctx.firestore(), 'brackets', 'b1'), { status: 'live', contenders: [] }); };

export const engagementCases: Case[] = [
  // --- streak ---------------------------------------------------------------
  { name: 'checking in the day after extends the streak', expect: 'allow', as: M, seed: seed(), run: (db) => checkIn(db, { streak: 6 }) },
  { name: 'checking in after a gap restarts the streak at 1', expect: 'allow', as: M, seed: seed({ lastLogin: day(-4) }), run: (db) => checkIn(db, { streak: 1 }) },
  { name: 'a freeze bridges one missed day', expect: 'allow', as: M, seed: seed({ lastLogin: day(-2), freezes: 1 }), run: (db) => checkIn(db, { streak: 6, freezes: 0 }) },
  { name: 'a freeze costs 5 credits', expect: 'allow', as: M, seed: seed(), run: (db) => buyFreeze(db) },
  {
    name: 'a streak cannot be typed in', expect: 'deny', killedBy: 'M126', as: M, seed: seed(),
    run: (db) => updateDoc(doc(db, 'users', M.uid), { streak: 50 }),
  },
  {
    name: 'a streak cannot move without checking in today', expect: 'deny', killedBy: 'M127', as: M, seed: seed({ lastLogin: day() }),
    run: (db) => updateDoc(doc(db, 'users', M.uid), { streak: 1 }),
  },
  {
    name: 'a streak is not extended after missing days', expect: 'deny', killedBy: 'M128', as: M, seed: seed({ lastLogin: day(-4) }),
    run: (db) => checkIn(db, { streak: 6 }),
  },
  {
    name: 'one missed day needs a freeze to keep the streak', expect: 'deny', killedBy: 'M129', as: M, seed: seed({ lastLogin: day(-2), freezes: 1 }),
    run: (db) => checkIn(db, { streak: 6 }),
  },
  {
    name: 'freezes cannot be added without paying', expect: 'deny', killedBy: 'M130', as: M, seed: seed(),
    run: (db) => updateDoc(doc(db, 'users', M.uid), { freezes: 2 }),
  },
  {
    name: 'no more than two freezes can be held', expect: 'deny', killedBy: 'M131', as: M, seed: seed({ freezes: 2 }),
    run: (db) => buyFreeze(db),
  },
  {
    name: 'a new profile cannot start with a streak or freezes', expect: 'deny', killedBy: 'M132', as: OTHER, seed: (ctx) => seedInvite(ctx),
    run: (db) => setDoc(doc(db, 'users', OTHER.uid), { credits: 13, isVerified: false, invitedWith: INVITE, streak: 365, freezes: 2 }),
  },
  {
    name: 'badges and invite counts are set by the nightly job, not the member', expect: 'deny', killedBy: 'M137', as: M, seed: seed(),
    run: (db) => updateDoc(doc(db, 'users', M.uid), { asker: true, invitedCount: 500 }),
  },
  // --- mind reader ------------------------------------------------------------
  { name: 'a prediction adds one to this week\'s score', expect: 'allow', as: M, seed: seedMind, run: (db) => setDoc(mind(db), { week: '2026-11-16', right: 4, total: 6 }) },
  { name: 'a new week starts the score again', expect: 'allow', as: M, seed: seedMind, run: (db) => setDoc(mind(db), { week: '2026-11-23', right: 1, total: 1 }) },
  {
    name: 'the weekly total cannot jump', expect: 'deny', killedBy: 'M133', as: M, seed: seedMind,
    run: (db) => setDoc(mind(db), { week: '2026-11-16', right: 4, total: 60 }),
  },
  {
    name: 'correct predictions cannot jump', expect: 'deny', killedBy: 'M134', as: M, seed: seedMind,
    run: (db) => setDoc(mind(db), { week: '2026-11-16', right: 6, total: 6 }),
  },
  // --- bracket reports --------------------------------------------------------
  { name: 'a member can report a bracket', expect: 'allow', as: M, seed: seedBracket, run: (db) => setDoc(doc(db, 'bracketReports', `${M.uid}_b1`), { bracketId: 'b1', reason: 'wrong', createdAt: 'x' }) },
  {
    name: 'a report cannot be filed in another member\'s name', expect: 'deny', killedBy: 'M135', as: OTHER, seed: seedBracket,
    run: (db) => setDoc(doc(db, 'bracketReports', `${M.uid}_b1`), { bracketId: 'b1', reason: 'wrong', createdAt: 'x' }),
  },
  {
    name: 'a report reason is one of the fixed choices', expect: 'deny', killedBy: 'M136', as: M, seed: seedBracket,
    run: (db) => setDoc(doc(db, 'bracketReports', `${M.uid}_b1`), { bracketId: 'b1', reason: 'free text about someone', createdAt: 'x' }),
  },
];
