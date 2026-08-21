import { doc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * groups/{groupId} -- invite-code proof and document-level tampering.
 *
 * Membership itself moved to groups/{groupId}/members/{uid}; those cases live
 * in groupMembers.cases.ts. What remains here is the proof-of-code mechanism
 * and the guards on the group document's own fields.
 */
const ADMIN_U = { uid: 'gadmin1', email: 'gadmin1@pulse.app' };
const MEMBER = { uid: 'gmember1', email: 'gmember1@pulse.app' };
const OUTSIDER = { uid: 'goutsider2', email: 'goutsider2@pulse.app' };
const GID = 'grp1';
const CODE = 'GRP001';

async function seedGroup(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'groups', GID), {
    name: 'Book Club',
    description: 'Monthly reads',
    inviteCode: CODE,
    adminUid: ADMIN_U.uid,
    memberCount: 2,
  });
  await setDoc(doc(db, 'groups', GID, 'members', ADMIN_U.uid), {
    uid: ADMIN_U.uid,
    joinedAt: '2026-08-19T00:00:00.000Z',
  });
  await setDoc(doc(db, 'groups', GID, 'members', MEMBER.uid), {
    uid: MEMBER.uid,
    joinedAt: '2026-08-19T00:00:00.000Z',
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

  {
    name: 'a proof holding a superseded invite code no longer admits',
    expect: 'deny',
    killedBy: 'M24',
    as: OUTSIDER,
    seed: async (ctx) => {
      await seedGroup(ctx);
      // Staged against an older code; the group has since rotated. Existence
      // alone must not be enough.
      await setDoc(proofRef(ctx.firestore(), OUTSIDER.uid), { code: 'OLDCDE' });
    },
    run: (db) =>
      setDoc(doc(db, 'groups', GID, 'members', OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
      }),
  },

  // --- document tampering ---------------------------------------------------
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
    name: 'a member cannot reintroduce a members array',
    expect: 'deny',
    killedBy: 'M18',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { members: [MEMBER.uid] }),
  },
  {
    name: 'an unauthenticated caller cannot touch a group',
    expect: 'deny',
    as: 'unauthenticated',
    note: 'Covered by the isAuthenticated() gate shared with every other update clause.',
    seed: seedGroup,
    run: (db) => updateDoc(groupRef(db), { memberCount: 99 }),
  },
];
