import { arrayRemove, arrayUnion, doc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * groups/{groupId} membership.
 *
 * Two legitimate update paths exist in the client:
 *   join  -- App.tsx handleJoin, arrayUnion(self) on members
 *   leave -- App.tsx handleLeave, arrayRemove(self) on members
 *
 * Joining is gated on the invite code, but the code never appears in the
 * members write and rules cannot inspect a query's where-clauses. Proof is
 * therefore staged in groups/{groupId}/joinRequests/{uid}: its create rule
 * compares the submitted code against the group document server-side, and the
 * join branch only has to confirm that document exists.
 */
const ADMIN = { uid: 'gadmin1', email: 'gadmin1@pulse.app' };
const MEMBER = { uid: 'gmember1', email: 'gmember1@pulse.app' };
const OUTSIDER = { uid: 'goutsider2', email: 'goutsider2@pulse.app' };
const GID = 'grp1';
const CODE = 'GRP001';

async function seedGroup(ctx: RulesTestContext) {
  await setDoc(doc(ctx.firestore(), 'groups', GID), {
    name: 'Book Club',
    description: 'Monthly reads',
    inviteCode: CODE,
    adminUid: ADMIN.uid,
    members: [ADMIN.uid, MEMBER.uid],
  });
}

/** Group plus an accepted proof-of-code for the outsider. */
async function seedGroupWithProof(ctx: RulesTestContext) {
  await seedGroup(ctx);
  await setDoc(doc(ctx.firestore(), 'groups', GID, 'joinRequests', OUTSIDER.uid), {
    code: CODE,
  });
}

const groupRef = (db: any) => doc(db, 'groups', GID);
const proofRef = (db: any, uid: string) => doc(db, 'groups', GID, 'joinRequests', uid);

export const groupsCases: Case[] = [
  // --- proof of invite code -------------------------------------------------
  {
    name: 'a proof carrying the correct invite code is accepted',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => setDoc(proofRef(db, OUTSIDER.uid), { code: CODE }),
  },
  {
    name: 'a proof carrying the wrong invite code is rejected',
    expect: 'deny',
    killedBy: 'M21',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => setDoc(proofRef(db, OUTSIDER.uid), { code: 'WRONG1' }),
  },
  {
    name: 'a proof carrying no code at all is rejected',
    expect: 'deny',
    killedBy: 'M21',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => setDoc(proofRef(db, OUTSIDER.uid), {}),
  },
  {
    name: 'a caller cannot forge a proof for someone else',
    expect: 'deny',
    killedBy: 'M22',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => setDoc(proofRef(db, 'someone-else'), { code: CODE }),
  },
  {
    name: 'a proof cannot smuggle extra fields onto the subcollection',
    expect: 'deny',
    killedBy: 'M23',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => setDoc(proofRef(db, OUTSIDER.uid), { code: CODE, elevated: true }),
  },

  // --- join / leave ---------------------------------------------------------
  {
    name: 'a non-member who proved the invite code may add themselves',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedGroupWithProof,
    run: (db) => updateDoc(groupRef(db), { members: arrayUnion(OUTSIDER.uid) }),
  },
  {
    name: 'a proof holding a superseded invite code no longer admits',
    expect: 'deny',
    killedBy: 'M24',
    as: OUTSIDER,
    seed: async (ctx) => {
      await seedGroup(ctx);
      // The proof was staged against an older code; the group has since
      // rotated. Existence alone must not be enough.
      await setDoc(doc(ctx.firestore(), 'groups', GID, 'joinRequests', OUTSIDER.uid), {
        code: 'OLDCDE',
      });
    },
    run: (db) => updateDoc(groupRef(db), { members: arrayUnion(OUTSIDER.uid) }),
  },
  {
    name: 'a non-member with no proof of the invite code cannot join',
    expect: 'deny',
    killedBy: 'M20',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: arrayUnion(OUTSIDER.uid) }),
  },
  {
    name: 'a member may remove themselves (leave)',
    expect: 'allow',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: arrayRemove(MEMBER.uid) }),
  },
  {
    name: 'leaving does not require a proof of the invite code',
    expect: 'allow',
    as: ADMIN,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: arrayRemove(ADMIN.uid) }),
  },

  // --- tampering ------------------------------------------------------------
  {
    name: 'a member cannot remove another member',
    expect: 'deny',
    killedBy: 'M17',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: arrayRemove(ADMIN.uid) }),
  },
  {
    name: 'a non-member cannot add someone other than themselves',
    expect: 'deny',
    killedBy: 'M17',
    // Proof is present, so the self-only shape check is the only thing left.
    as: OUTSIDER,
    seed: seedGroupWithProof,
    run: (db) => updateDoc(groupRef(db), { members: arrayUnion('someone-else') }),
  },
  {
    name: 'a member cannot rename the group',
    expect: 'deny',
    killedBy: 'M18',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { name: 'Hijacked' }),
  },
  {
    name: 'a member cannot reassign the group admin to themselves',
    expect: 'deny',
    killedBy: 'M18',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { adminUid: MEMBER.uid }),
  },
  {
    name: 'a member cannot change the invite code',
    expect: 'deny',
    killedBy: 'M18',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { inviteCode: 'STOLEN' }),
  },
  {
    name: 'joining and renaming in one write is rejected',
    expect: 'deny',
    killedBy: 'M18',
    as: OUTSIDER,
    seed: seedGroupWithProof,
    run: (db) =>
      updateDoc(groupRef(db), { members: arrayUnion(OUTSIDER.uid), name: 'Hijacked' }),
  },
  {
    name: 'an unauthenticated caller cannot join a group',
    expect: 'deny',
    as: 'unauthenticated',
    note: 'Covered by the isAuthenticated() gate shared with every other update clause.',
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: arrayUnion('anon') }),
  },
];
