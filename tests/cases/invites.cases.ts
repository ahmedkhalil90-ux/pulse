import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';
import { INVITE, INVITER_UID, seedInvite } from '../helpers/fixtures';

const NEWBIE = { uid: 'inv-newbie', email: 'newbie@example.com' };
const MEMBER = { uid: 'inv-member', email: 'member@example.com' };
const profile = (extra: Record<string, unknown> = {}) => ({ isVerified: false, credits: 13, invitedWith: INVITE, ...extra });

/** counters/members at `last`, and MEMBER's profile without a number. */
async function seedCounter(ctx: RulesTestContext, last = 41, memberExtra: Record<string, unknown> = {}) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'counters', 'members'), { last });
  await setDoc(doc(db, 'users', MEMBER.uid), { credits: 5, invitedWith: INVITE, ...memberExtra });
}
/** The client's claim: counter +1, memberNumbers/{n}, profile. */
const claim = (db: any, n: number, opts: { counter?: number; forUid?: string; profileNumber?: number } = {}) =>
  runTransaction(db, async (tx) => {
    tx.update(doc(db, 'counters', 'members'), { last: opts.counter ?? n });
    tx.set(doc(db, 'memberNumbers', String(n)), { uid: opts.forUid ?? MEMBER.uid });
    tx.update(doc(db, 'users', MEMBER.uid), { memberNumber: opts.profileNumber ?? n });
  });

export const invitesCases: Case[] = [
  // --- invite-only sign-up -------------------------------------------------
  {
    name: 'sign-up with a member invite creates the profile',
    expect: 'allow',
    as: NEWBIE,
    seed: (ctx) => seedInvite(ctx),
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), profile()),
  },
  {
    name: 'sign-up without an invite is refused',
    expect: 'deny',
    killedBy: 'M89',
    as: NEWBIE,
    seed: (ctx) => seedInvite(ctx),
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), (({ invitedWith, ...rest }) => rest)(profile())),
  },
  {
    name: 'sign-up with a made-up invite code is refused',
    expect: 'deny',
    killedBy: 'M89',
    as: NEWBIE,
    seed: (ctx) => seedInvite(ctx),
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), profile({ invitedWith: 'NOPE99' })),
  },
  {
    name: 'sign-up with a paused invite link is refused',
    expect: 'deny',
    killedBy: 'M90',
    as: NEWBIE,
    seed: (ctx) => seedInvite(ctx, { paused: true }),
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), profile()),
  },
  {
    name: 'an invite from a member who has not unlocked inviting is refused',
    expect: 'deny',
    killedBy: 'M91',
    as: NEWBIE,
    seed: async (ctx) => {
      await seedInvite(ctx);
      await setDoc(doc(ctx.firestore(), 'users', INVITER_UID), { username: 'inviter', credits: 0, referralCode: INVITE });
    },
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), profile()),
  },
  {
    name: 'a new profile cannot arrive holding a member number',
    expect: 'deny',
    killedBy: 'M92',
    as: NEWBIE,
    seed: (ctx) => seedInvite(ctx),
    run: (db) => setDoc(doc(db, 'users', NEWBIE.uid), profile({ memberNumber: 1 })),
  },
  // --- member numbers -----------------------------------------------------
  {
    name: 'a member claims the next number in one transaction',
    expect: 'allow',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx),
    run: (db) => claim(db, 42),
  },
  {
    name: 'a member cannot just write a member number onto their profile',
    expect: 'deny',
    killedBy: 'M93',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx),
    run: (db) => updateDoc(doc(db, 'users', MEMBER.uid), { memberNumber: 1 }),
  },
  {
    name: 'a member number, once set, cannot be swapped for a better one',
    expect: 'deny',
    killedBy: 'M94',
    as: MEMBER,
    seed: async (ctx) => { await seedCounter(ctx, 41, { memberNumber: 7 }); await setDoc(doc(ctx.firestore(), 'memberNumbers', '3'), { uid: MEMBER.uid }); },
    // memberNumbers/3 already names them (say, an admin fix-up): the only
    // thing stopping the swap is that their number is already set.
    run: (db) => updateDoc(doc(db, 'users', MEMBER.uid), { memberNumber: 3 }),
  },
  {
    name: 'the counter cannot jump ahead',
    expect: 'deny',
    killedBy: 'M95',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx),
    run: (db) => claim(db, 100),
  },
  {
    name: 'the counter cannot be advanced without claiming the number',
    expect: 'deny',
    killedBy: 'M96',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx),
    run: (db) => updateDoc(doc(db, 'counters', 'members'), { last: 42 }),
  },
  {
    name: 'a member cannot pick a number other than the next one',
    expect: 'deny',
    killedBy: 'M97',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx),
    run: (db) => runTransaction(db, async (tx) => {
      tx.set(doc(db, 'memberNumbers', '1'), { uid: MEMBER.uid });
      tx.update(doc(db, 'users', MEMBER.uid), { memberNumber: 1 });
    }),
  },
  {
    name: 'a member who has a number cannot reserve another',
    expect: 'deny',
    killedBy: 'M94',
    as: MEMBER,
    seed: (ctx) => seedCounter(ctx, 41, { memberNumber: 7 }),
    run: (db) => claim(db, 42),
  },
  {
    name: 'who holds which number is not readable',
    expect: 'deny',
    note: 'get is admin-only; no single guard to loosen.',
    as: MEMBER,
    seed: async (ctx) => { await seedCounter(ctx); await setDoc(doc(ctx.firestore(), 'memberNumbers', '1'), { uid: INVITER_UID }); },
    run: (db) => getDoc(doc(db, 'memberNumbers', '1')),
  },
  // --- waitlist -----------------------------------------------------------
  {
    name: 'anyone can join the waitlist with an email address',
    expect: 'allow',
    as: 'unauthenticated',
    run: (db) => setDoc(doc(db, 'waitlist', 'w1'), { email: 'friend@example.com', lang: 'ar', createdAt: serverTimestamp() }),
  },
  {
    name: 'the waitlist stores nothing but email, language and time',
    expect: 'deny',
    killedBy: 'M98',
    as: 'unauthenticated',
    run: (db) => setDoc(doc(db, 'waitlist', 'w1'), { email: 'friend@example.com', phone: '+971500000000', createdAt: serverTimestamp() }),
  },
  {
    name: 'the waitlist only accepts an email address',
    expect: 'deny',
    killedBy: 'M99',
    as: 'unauthenticated',
    run: (db) => setDoc(doc(db, 'waitlist', 'w1'), { email: 'not an email', createdAt: serverTimestamp() }),
  },
  {
    name: 'the waitlist is not readable by members',
    expect: 'deny',
    note: 'read is admin-only; no single guard to loosen.',
    as: MEMBER,
    seed: async (ctx) => { await setDoc(doc(ctx.firestore(), 'waitlist', 'w1'), { email: 'friend@example.com' }); },
    run: (db) => getDoc(doc(db, 'waitlist', 'w1')),
  },
];
