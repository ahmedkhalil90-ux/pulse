import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * Admin identity.
 *
 * isAdmin() used to trust `request.auth.token.email` against a fixed list
 * containing ak@pulse.app and ahmedkhalil90@pulse.app. AuthProvider builds
 * every credential as `${username}@pulse.app`, so signing up with the username
 * `ak` produced a genuine token bearing an allow-listed address -- registering
 * a username granted full admin. It also trusted users/{uid}.role, which the
 * owner could write to their own profile.
 *
 * Admin now keys on UID alone: one hardcoded UID, plus the admins/{uid}
 * roster, which no client can read or write.
 *
 * Deleting a results document is used throughout as the admin-only probe --
 * `allow delete: if isAdmin()`.
 */

/** The real admin account, ak2@pulse.app. */
const REAL_ADMIN = { uid: '7zNbw98m9jZYy8uTan7dqwolBud2', email: 'ak2@pulse.app' };
/** Someone who registers the username `ak` after the fact. */
const FAKE_AK = { uid: 'freshly-registered-ak', email: 'ak@pulse.app' };
/** Someone who registers `ak2` -- the email must not be what counts. */
const FAKE_AK2 = { uid: 'freshly-registered-ak2', email: 'ak2@pulse.app' };
const FAKE_AHMED = { uid: 'freshly-registered-ahmed', email: 'ahmedkhalil90@pulse.app' };
const FAKE_GMAIL = { uid: 'freshly-registered-gmail', email: 'ahmedkhalil90@gmail.com' };
/** The stale UID that used to be hardcoded. */
const OLD_HARDCODED = { uid: 'sj03xZJ5ucVRqDIXvBc5R3H2wmz1', email: 'someone@pulse.app' };
/** Granted admin the supported way, via the roster. */
const ROSTERED = { uid: 'rostered-admin', email: 'rostered@pulse.app' };
const PLAIN = { uid: 'plain-user', email: 'plain@pulse.app' };

const QID = 'admin-probe-q';

const seedResults = (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'results', QID), { counts: { '0': 4, '1': 6 }, demographics: {} });

async function seedResultsAndRoster(ctx: RulesTestContext) {
  await seedResults(ctx);
  await setDoc(doc(ctx.firestore(), 'admins', ROSTERED.uid), { note: 'granted by hand' });
}

/** Profile carrying the old self-asserted role field, which must now be inert. */
async function seedRoleClaim(ctx: RulesTestContext) {
  await seedResults(ctx);
  await setDoc(doc(ctx.firestore(), 'users', PLAIN.uid), {
    username: 'plain',
    isVerified: true,
    credits: 0,
    role: 'admin',
  });
}

const deleteResults = (db: any) => deleteDoc(doc(db, 'results', QID));

export const adminIdentityCases: Case[] = [
  // --- who is actually an admin --------------------------------------------
  {
    name: 'the real admin UID has admin powers',
    expect: 'allow',
    as: REAL_ADMIN,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'a UID on the admins roster has admin powers',
    expect: 'allow',
    as: ROSTERED,
    seed: seedResultsAndRoster,
    run: deleteResults,
  },
  {
    name: 'an ordinary user has no admin powers',
    expect: 'deny',
    killedBy: 'M50',
    as: PLAIN,
    seed: seedResults,
    run: deleteResults,
  },

  // --- the registerable-username attack ------------------------------------
  {
    name: 'a newly registered `ak` gets no admin powers',
    expect: 'deny',
    killedBy: 'M51',
    as: FAKE_AK,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'a newly registered `ak2` gets no admin powers',
    expect: 'deny',
    killedBy: 'M51',
    // The email matching the real admin's must count for nothing; only the UID
    // does.
    as: FAKE_AK2,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'a newly registered `ahmedkhalil90` gets no admin powers',
    expect: 'deny',
    killedBy: 'M51',
    as: FAKE_AHMED,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'a token bearing the gmail address gets no admin powers',
    expect: 'deny',
    killedBy: 'M51',
    as: FAKE_GMAIL,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'the previously hardcoded UID no longer has admin powers',
    expect: 'deny',
    killedBy: 'M50',
    as: OLD_HARDCODED,
    seed: seedResults,
    run: deleteResults,
  },
  {
    name: 'a self-written role field grants nothing',
    expect: 'deny',
    killedBy: 'M52',
    as: PLAIN,
    seed: seedRoleClaim,
    run: deleteResults,
  },

  // --- the roster is sealed -------------------------------------------------
  {
    name: 'a client cannot add itself to the admins roster',
    expect: 'deny',
    killedBy: 'M53',
    as: PLAIN,
    run: (db) => setDoc(doc(db, 'admins', PLAIN.uid), { note: 'self-granted' }),
  },
  {
    name: 'even the real admin cannot write the roster from a client',
    expect: 'deny',
    killedBy: 'M53',
    // Console or Admin SDK only, so a compromised admin session cannot mint
    // more admins.
    as: REAL_ADMIN,
    run: (db) => setDoc(doc(db, 'admins', 'someone-new'), { note: 'x' }),
  },
  {
    name: 'a client cannot remove an admin from the roster',
    expect: 'deny',
    killedBy: 'M53',
    as: PLAIN,
    seed: seedResultsAndRoster,
    run: (db) => deleteDoc(doc(db, 'admins', ROSTERED.uid)),
  },
  {
    name: 'a client cannot read the admins roster',
    expect: 'deny',
    killedBy: 'M53',
    // Admins should not be enumerable before being targeted.
    as: PLAIN,
    seed: seedResultsAndRoster,
    run: (db) => getDoc(doc(db, 'admins', ROSTERED.uid)),
  },
  {
    name: 'an admin can check their own roster entry (to show the review queue)',
    expect: 'allow',
    as: ROSTERED,
    seed: seedResultsAndRoster,
    run: (db) => getDoc(doc(db, 'admins', ROSTERED.uid)),
  },
  {
    name: 'a non-admin can check their own (missing) roster entry',
    expect: 'allow',
    as: PLAIN,
    seed: seedResultsAndRoster,
    run: (db) => getDoc(doc(db, 'admins', PLAIN.uid)),
  },
  {
    name: "a user cannot check whether someone else is an admin",
    expect: 'deny',
    killedBy: 'M81',
    as: PLAIN,
    seed: seedResultsAndRoster,
    run: (db) => getDoc(doc(db, 'admins', ROSTERED.uid)),
  },
];
