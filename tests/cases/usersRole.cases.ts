import { doc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * users/{userId} update -- privilege escalation via `role`.
 *
 * isAdmin() (firestore.rules) consults users/{uid}.role. The update rule
 * previously let the owner write any field, so a caller could set their own
 * role to 'admin' and satisfy every isAdmin() gate in the file: renaming any
 * group, deleting any results document, rewriting any question.
 *
 * The client never reads or writes `role`.
 */
const USER = { uid: 'roleuser1', email: 'roleuser1@pulse.app' };
const OTHER = { uid: 'roleuser2', email: 'roleuser2@pulse.app' };
/** Admin by the email allowlist, not by a self-written field. */
const REAL_ADMIN = { uid: '7zNbw98m9jZYy8uTan7dqwolBud2', email: 'ahmedkhalil90@gmail.com' };

const seedUser = (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'users', USER.uid), {
    username: 'roleuser1',
    isVerified: true,
    credits: 5,
    lastLogin: '2026-08-19',
  });

const userRef = (db: any) => doc(db, 'users', USER.uid);

export const usersRoleCases: Case[] = [
  {
    name: 'the owner can still update their own profile',
    expect: 'allow',
    as: USER,
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { lastLogin: '2026-08-20' }),
  },
  {
    name: 'the owner cannot promote themselves to admin',
    expect: 'deny',
    killedBy: 'M25',
    as: USER,
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { role: 'admin' }),
  },
  {
    name: 'the owner cannot smuggle a role change alongside a legitimate field',
    expect: 'deny',
    killedBy: 'M25',
    as: USER,
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { lastLogin: '2026-08-20', role: 'admin' }),
  },
  {
    name: 'the owner cannot set role to any other value either',
    expect: 'deny',
    killedBy: 'M25',
    as: USER,
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { role: 'moderator' }),
  },
  {
    name: 'a migrating caller cannot smuggle a role change',
    expect: 'deny',
    killedBy: 'M25',
    as: { uid: 'newroleuid', email: 'roleuser1@pulse.app' },
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { credits: 6, role: 'admin' }),
  },
  {
    name: 'a real admin may still set role',
    expect: 'allow',
    as: REAL_ADMIN,
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { role: 'admin' }),
  },
  // --- create and delete paths ---------------------------------------------
  // The update guard alone is not enough: a document that can be created --
  // or deleted and re-created -- holding role:'admin' bypasses it entirely.
  {
    name: 'signup can still create its own profile',
    expect: 'allow',
    as: USER,
    run: (db) =>
      setDoc(doc(db, 'users', USER.uid), {
        username: 'roleuser1',
        isVerified: true,
        credits: 10,
      }),
  },
  {
    name: 'a new profile cannot be created holding role admin',
    expect: 'deny',
    killedBy: 'M34',
    as: USER,
    run: (db) =>
      setDoc(doc(db, 'users', USER.uid), {
        username: 'roleuser1',
        isVerified: true,
        credits: 10,
        role: 'admin',
      }),
  },
  {
    name: 'a profile cannot be re-created with role admin after deletion',
    expect: 'deny',
    killedBy: 'M34',
    as: USER,
    // Deleting your own profile is permitted; re-creating it elevated is not.
    run: (db) =>
      setDoc(doc(db, 'users', USER.uid), {
        username: 'roleuser1',
        isVerified: true,
        credits: 10,
        role: 'admin',
      }),
  },
  {
    name: 'a profile cannot be created for someone else',
    expect: 'deny',
    killedBy: 'M35',
    as: USER,
    run: (db) =>
      setDoc(doc(db, 'users', 'victim-uid'), {
        username: 'victim',
        isVerified: true,
        credits: 10,
      }),
  },
  {
    name: 'a stranger still cannot touch another user profile at all',
    expect: 'deny',
    as: OTHER,
    note: 'Covered by the isOwner/isAdmin/isMigrating gate, not the role guard.',
    seed: seedUser,
    run: (db) => updateDoc(userRef(db), { credits: 999 }),
  },
];
