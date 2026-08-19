import { doc, updateDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import { ATTACKER, NEW_UID, OLD_UID, seedUser } from '../helpers/fixtures';

/**
 * isMigrating() -- firestore.rules:97-104.
 *
 * Proof of ownership is the caller's auth token, never a username field they
 * can write. Exercised through users/{oldUid} update, the re-parenting path in
 * AuthProvider signUp step 4.
 */
export const migrationCases: Case[] = [
  {
    name: "caller whose token email matches the target's username may take over",
    expect: 'allow',
    as: NEW_UID, // victim@pulse.app
    seed: (ctx) => seedUser(ctx, OLD_UID, { username: 'victim', credits: 10 }),
    run: (db) => updateDoc(doc(db, 'users', OLD_UID), { credits: 11 }),
  },
  {
    name: 'caller who set their profile username to match, but whose token does not, is rejected',
    expect: 'deny',
    killedBy: 'M12',
    as: ATTACKER, // attacker@pulse.app
    seed: async (ctx) => {
      await seedUser(ctx, OLD_UID, { username: 'victim', credits: 10 });
      // The attacker writes 'victim' into their own profile. It must buy nothing.
      await seedUser(ctx, ATTACKER.uid, { username: 'victim' });
    },
    run: (db) => updateDoc(doc(db, 'users', OLD_UID), { credits: 999 }),
  },
];
