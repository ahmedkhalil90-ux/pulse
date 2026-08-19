import { arrayRemove, arrayUnion, doc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * groups/{groupId} update access.
 *
 * Only two legitimate update paths exist in the client:
 *   join  -- App.tsx:2152, arrayUnion(self) on members
 *   leave -- App.tsx:1802, arrayRemove(self) on members
 *
 * Everything else -- renaming, reassigning the admin, adding or removing
 * someone else -- has no call site and must be refused. Self-join by a
 * non-member has to stay open: joining is by invite code, and rules cannot
 * inspect a query's where-clauses to confirm the caller knew it.
 */
const ADMIN = { uid: 'gadmin1', email: 'gadmin1@pulse.app' };
const MEMBER = { uid: 'gmember1', email: 'gmember1@pulse.app' };
const OUTSIDER = { uid: 'goutsider2', email: 'goutsider2@pulse.app' };
const GID = 'grp1';

const seedGroup = (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'groups', GID), {
    name: 'Book Club',
    description: 'Monthly reads',
    inviteCode: 'GRP001',
    adminUid: ADMIN.uid,
    members: [ADMIN.uid, MEMBER.uid],
  });

const groupRef = (db: any) => doc(db, 'groups', GID);

export const groupsCases: Case[] = [
  {
    name: 'a non-member may add themselves (join by invite code)',
    expect: 'allow',
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
    as: OUTSIDER,
    seed: seedGroup,
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
    seed: seedGroup,
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
