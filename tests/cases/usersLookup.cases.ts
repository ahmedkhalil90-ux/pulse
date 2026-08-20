import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * users listability, and the lookup collections that replace it.
 *
 * `users` was listable by any authenticated user, dumping every username with
 * demographics and credit balance. Three client call sites depended on that
 * scan:
 *
 *   AuthProvider signUp   -- orphan-profile lookup by username
 *   AuthProvider signIn   -- migration sweep by username
 *   AuthProvider redeem   -- referral lookup by referralCode
 *
 * They are replaced by two mappings whose document ID is the thing being
 * looked up, so each becomes a `get` and `list` can be withdrawn entirely:
 *
 *   usernames/{lowercased} -> { uid }
 *   referralCodes/{code}   -> { uid }
 *
 * Username uniqueness is NOT enforced by any of this -- Firebase Auth enforces
 * it via the synthetic `username@pulse.app` address, which is also what makes
 * the usernames mapping safe to write: only the account authenticated as that
 * username can claim it.
 */
const OWNER = { uid: 'lookupowner', email: 'alice@pulse.app' };
const OTHER = { uid: 'lookupother', email: 'bob@pulse.app' };

async function seedUsers(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', OWNER.uid), {
    username: 'alice',
    isVerified: true,
    credits: 42,
    referralCode: 'ALICE1',
    demographics: { ageRange: '25-34', gender: 'Male', country: 'UAE' },
  });
  await setDoc(doc(db, 'users', OTHER.uid), {
    username: 'bob',
    isVerified: true,
    credits: 7,
    referralCode: 'BOBBY1',
  });
}

export const usersLookupCases: Case[] = [
  // --- the leak itself ------------------------------------------------------
  {
    name: 'an authenticated user cannot list the users collection',
    expect: 'deny',
    killedBy: 'M15',
    as: OTHER,
    seed: seedUsers,
    run: (db) => getDocs(collection(db, 'users')),
  },
  {
    name: 'a single profile is still readable by document ID',
    expect: 'allow',
    // Games and groups display usernames, which is a get, not a scan.
    as: OTHER,
    seed: seedUsers,
    run: (db) => getDoc(doc(db, 'users', OWNER.uid)),
  },

  // --- usernames mapping ----------------------------------------------------
  {
    name: 'a caller may claim the username mapping they are authenticated as',
    expect: 'allow',
    as: OWNER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'usernames', 'alice'), { uid: OWNER.uid }),
  },
  {
    name: 'a caller cannot claim a username mapping belonging to someone else',
    expect: 'deny',
    killedBy: 'M16',
    // bob@pulse.app trying to seize the 'alice' mapping.
    as: OTHER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'usernames', 'alice'), { uid: OTHER.uid }),
  },
  {
    name: 'a username mapping cannot point at a different uid',
    expect: 'deny',
    killedBy: 'M17',
    as: OWNER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'usernames', 'alice'), { uid: OTHER.uid }),
  },
  {
    name: 'a username mapping cannot carry extra fields',
    expect: 'deny',
    killedBy: 'M18',
    as: OWNER,
    seed: seedUsers,
    run: (db) =>
      setDoc(doc(db, 'usernames', 'alice'), { uid: OWNER.uid, credits: 999 }),
  },
  {
    name: 'a username mapping is readable by document ID',
    expect: 'allow',
    as: OTHER,
    seed: async (ctx) => {
      await seedUsers(ctx);
      await setDoc(doc(ctx.firestore(), 'usernames', 'alice'), { uid: OWNER.uid });
    },
    run: (db) => getDoc(doc(db, 'usernames', 'alice')),
  },
  {
    name: 'the usernames collection cannot be listed',
    expect: 'deny',
    killedBy: 'M19',
    // Otherwise the mapping just becomes a second way to enumerate everyone.
    as: OTHER,
    seed: async (ctx) => {
      await seedUsers(ctx);
      await setDoc(doc(ctx.firestore(), 'usernames', 'alice'), { uid: OWNER.uid });
    },
    run: (db) => getDocs(collection(db, 'usernames')),
  },

  // --- referralCodes mapping ------------------------------------------------
  {
    name: 'a user may register the referral code their profile holds',
    expect: 'allow',
    as: OWNER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'referralCodes', 'ALICE1'), { uid: OWNER.uid }),
  },
  {
    name: 'a user cannot register a code their profile does not hold',
    expect: 'deny',
    killedBy: 'M20',
    // Squatting a code someone else will later generate would hijack their
    // referrals, so the code is checked against the caller's own profile.
    as: OTHER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'referralCodes', 'FUTURE'), { uid: OTHER.uid }),
  },
  {
    name: 'a referral mapping cannot point at a different uid',
    expect: 'deny',
    killedBy: 'M21',
    as: OWNER,
    seed: seedUsers,
    run: (db) => setDoc(doc(db, 'referralCodes', 'ALICE1'), { uid: OTHER.uid }),
  },
  {
    name: 'a referral mapping is readable by document ID',
    expect: 'allow',
    as: OTHER,
    seed: async (ctx) => {
      await seedUsers(ctx);
      await setDoc(doc(ctx.firestore(), 'referralCodes', 'ALICE1'), { uid: OWNER.uid });
    },
    run: (db) => getDoc(doc(db, 'referralCodes', 'ALICE1')),
  },
  {
    name: 'the referralCodes collection cannot be listed',
    expect: 'deny',
    killedBy: 'M22',
    as: OTHER,
    seed: async (ctx) => {
      await seedUsers(ctx);
      await setDoc(doc(ctx.firestore(), 'referralCodes', 'ALICE1'), { uid: OWNER.uid });
    },
    run: (db) => getDocs(collection(db, 'referralCodes')),
  },
];
