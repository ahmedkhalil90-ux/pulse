import { doc, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';
import { INVITE, seedInvite } from '../helpers/fixtures';

/**
 * Credits move only with the action that earns or spends them, in the same
 * write, with the reason recorded privately in users/{uid}/private/credit.
 */
const M = { uid: 'cr-member', email: 'cr@example.com' };
const Q = 'cr-q1';
const today = () => new Date().toISOString().slice(0, 10);

async function seed(ctx: RulesTestContext, credits = 20, extra: Record<string, unknown> = {}) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', M.uid), { credits, lastLogin: '2026-01-01', demographics: {}, ...extra });
  await setDoc(doc(db, 'questions', Q), { text: 'Karak or flat white?', options: ['Karak', 'Flat white'], authorUid: M.uid, status: 'live', isPublic: true, boostCount: 0, flags: 0 });
}
const answerDoc = { userId: M.uid, questionId: Q, answerIndex: 0, answeredAt: '2026-11-09T00:00:00Z', option0PercentAtTime: 50, option1PercentAtTime: 50 };
const reason = (db: any, b: ReturnType<typeof writeBatch>, r: string, ref = '') =>
  b.set(doc(db, 'users', M.uid, 'private', 'credit'), { reason: r, ref, at: serverTimestamp() });

/** The app's answer write: record + credit + reason. */
function answerAndEarn(db: any, amount = 1, opts: { skipReason?: boolean; skipAnswer?: boolean } = {}) {
  const b = writeBatch(db);
  if (!opts.skipAnswer) b.set(doc(db, 'user_answers', `${M.uid}_${Q}`), answerDoc);
  b.update(doc(db, 'users', M.uid), { credits: increment(amount) });
  if (!opts.skipReason) reason(db, b, 'answer', Q);
  return b.commit();
}
function daily(db: any, day = today()) {
  const b = writeBatch(db);
  b.update(doc(db, 'users', M.uid), { credits: increment(3), lastLogin: day });
  reason(db, b, 'daily');
  return b.commit();
}
function unlock(db: any) {
  const b = writeBatch(db);
  b.set(doc(db, 'users', M.uid, 'unlockedDemographics', Q), { unlockedAt: '2026-11-09T00:00:00Z' });
  b.update(doc(db, 'users', M.uid), { credits: increment(-3) });
  reason(db, b, 'unlock', Q);
  return b.commit();
}

export const creditsRulesCases: Case[] = [
  { name: 'answering earns +1 together with the answer record', expect: 'allow', as: M, seed: (c) => seed(c), run: (db) => answerAndEarn(db) },
  { name: 'the daily bonus pays +3 once, for today', expect: 'allow', as: M, seed: (c) => seed(c), run: (db) => daily(db) },
  { name: 'unlocking a breakdown costs 3 together with the unlock record', expect: 'allow', as: M, seed: (c) => seed(c), run: (db) => unlock(db) },
  {
    name: 'boosting costs 10 together with +100 impressions', expect: 'allow', as: M, seed: (c) => seed(c),
    run: (db) => { const b = writeBatch(db); b.update(doc(db, 'questions', Q), { boostCount: increment(100) }); b.update(doc(db, 'users', M.uid), { credits: increment(-10) }); reason(db, b, 'boost', Q); return b.commit(); },
  },
  {
    name: 'finishing a Knockout bracket earns +1 together with the picks', expect: 'allow', as: M,
    seed: async (c) => { await seed(c); await setDoc(doc(c.firestore(), 'brackets', 'b1'), { status: 'live', contenders: [] }); },
    run: (db) => {
      const b = writeBatch(db);
      b.set(doc(db, 'bracketPicks', `${M.uid}_b1`), { bracketId: 'b1', picks: [0, 2, 4, 6, 0, 4, 0], createdAt: 'x' });
      b.update(doc(db, 'users', M.uid), { credits: increment(1) });
      reason(db, b, 'bracket', 'b1');
      return b.commit();
    },
  },
  {
    name: 'a redeemed referral pays +15 together with the referral record', expect: 'allow', as: M,
    seed: async (c) => { await seed(c); await seedInvite(c); },
    run: (db) => {
      const b = writeBatch(db);
      b.set(doc(db, 'referrals', M.uid), { code: INVITE, referrerUid: 'inviter1', createdAt: '2026-11-09T00:00:00Z' });
      b.update(doc(db, 'users', M.uid), { credits: increment(15), referredBy: true });
      reason(db, b, 'referral');
      return b.commit();
    },
  },
  {
    name: 'a member cannot grant themselves credits',
    expect: 'deny', killedBy: 'M114', as: M, seed: (c) => seed(c),
    run: (db) => updateDoc(doc(db, 'users', M.uid), { credits: increment(1000) }),
  },
  {
    name: 'an answer cannot be paid twice',
    expect: 'deny', killedBy: 'M115', as: M,
    seed: async (c) => { await seed(c); await setDoc(doc(c.firestore(), 'user_answers', `${M.uid}_${Q}`), answerDoc); },
    run: (db) => answerAndEarn(db, 1, { skipAnswer: true }),
  },
  {
    name: 'an answer pays exactly 1',
    expect: 'deny', killedBy: 'M116', as: M, seed: (c) => seed(c),
    run: (db) => answerAndEarn(db, 50),
  },
  {
    name: 'a reason left over from an earlier write cannot be reused',
    expect: 'deny', killedBy: 'M117', as: M,
    seed: async (c) => { await seed(c); await setDoc(doc(c.firestore(), 'users', M.uid, 'private', 'credit'), { reason: 'answer', ref: Q, at: new Date('2026-01-01') }); },
    run: (db) => answerAndEarn(db, 1, { skipReason: true }),
  },
  {
    name: 'spending cannot take the balance below zero',
    expect: 'deny', killedBy: 'M118', as: M, seed: (c) => seed(c, 2),
    run: (db) => unlock(db),
  },
  {
    name: 'the daily bonus cannot be taken twice in a day',
    expect: 'deny', killedBy: 'M119', as: M, seed: (c) => seed(c, 20, { lastLogin: today() }),
    run: (db) => daily(db),
  },
  {
    name: 'the daily bonus cannot be claimed for another date',
    expect: 'deny', killedBy: 'M120', as: M, seed: (c) => seed(c),
    run: (db) => daily(db, '2030-01-01'),
  },
  {
    name: 'a new profile cannot start with a big balance',
    expect: 'deny', killedBy: 'M121', as: M, seed: (c) => seedInvite(c),
    run: (db) => setDoc(doc(db, 'users', M.uid), { credits: 1000, isVerified: false, invitedWith: INVITE }),
  },
  {
    name: 'the private reason record holds nothing else',
    expect: 'deny', killedBy: 'M122', as: M, seed: (c) => seed(c),
    run: (db) => setDoc(doc(db, 'users', M.uid, 'private', 'credit'), { reason: 'answer', ref: Q, at: serverTimestamp(), answerIndex: 0 }),
  },
  {
    name: "a member cannot write another member's reason record",
    expect: 'deny', note: 'isOwner() is shared with every owner check; no single guard to loosen.', as: { uid: 'cr-other', email: 'o@example.com' }, seed: (c) => seed(c),
    run: (db) => setDoc(doc(db, 'users', M.uid, 'private', 'credit'), { reason: 'answer', ref: Q, at: serverTimestamp() }),
  },
];
