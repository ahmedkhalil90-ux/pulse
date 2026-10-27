import { collection, deleteDoc, doc, getDoc, getDocs, increment, query, setDoc, updateDoc, where } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * groups member privacy.
 *
 * The group document used to carry a `members` array of every member's UID,
 * readable by anyone signed in -- while the members tab is only ever meant to
 * show a count. Membership is now one document per member under
 * groups/{groupId}/members/{uid}, readable only by that member, and the group
 * carries `memberCount`.
 *
 * Joining is still gated on the invite code: the proof is enforced on the
 * membership document's create, and the count update only has to confirm the
 * membership document's existence.
 */
const ADMIN_U = { uid: 'gm-admin', email: 'gmadmin@pulse.app' };
const MEMBER = { uid: 'gm-member', email: 'gmmember@pulse.app' };
const OUTSIDER = { uid: 'gm-outsider', email: 'gmoutsider@pulse.app' };
const GID = 'gm-group';
const CODE = 'GMCODE';

async function seedGroup(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'groups', GID), {
    name: 'Book Club',
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

/** Group plus an accepted invite-code proof for the outsider. */
async function seedWithProof(ctx: RulesTestContext) {
  await seedGroup(ctx);
  await setDoc(doc(ctx.firestore(), 'groups', GID, 'joinRequests', OUTSIDER.uid), {
    code: CODE,
  });
}

/** As above, and the outsider has already joined. */
async function seedJoined(ctx: RulesTestContext) {
  await seedWithProof(ctx);
  await setDoc(doc(ctx.firestore(), 'groups', GID, 'members', OUTSIDER.uid), {
    uid: OUTSIDER.uid,
    joinedAt: '2026-08-20T00:00:00.000Z',
  });
}

const memberRef = (db: any, uid: string) => doc(db, 'groups', GID, 'members', uid);
const groupRef = (db: any) => doc(db, 'groups', GID);

export const groupMembersCases: Case[] = [
  // --- the roster is private ------------------------------------------------
  {
    name: 'a member can read their own membership document',
    expect: 'allow',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => getDoc(memberRef(db, MEMBER.uid)),
  },
  {
    name: "a member cannot read another member's membership document",
    expect: 'deny',
    killedBy: 'M38',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => getDoc(memberRef(db, ADMIN_U.uid)),
  },
  {
    name: 'nobody can list a group roster',
    expect: 'deny',
    killedBy: 'M39',
    // This is the whole point: the members tab shows memberCount, never names.
    as: MEMBER,
    seed: seedGroup,
    run: (db) => getDocs(collection(db, 'groups', GID, 'members')),
  },
  {
    name: 'a member may run the my-groups query scoped to themselves',
    expect: 'allow',
    as: MEMBER,
    seed: seedGroup,
    run: (db) =>
      getDocs(
        query(collection(db, 'groups', GID, 'members'), where('uid', '==', MEMBER.uid)),
      ),
  },
  {
    name: "a member cannot query for someone else's membership",
    expect: 'deny',
    killedBy: 'M39',
    as: MEMBER,
    seed: seedGroup,
    run: (db) =>
      getDocs(
        query(collection(db, 'groups', GID, 'members'), where('uid', '==', ADMIN_U.uid)),
      ),
  },

  // --- creation -------------------------------------------------------------
  {
    name: 'the group creator can add their own membership without a proof',
    expect: 'allow',
    killedBy: undefined,
    // They invented the invite code, so they have no joinRequests document.
    // Missing this made memberCount say 1 over an empty roster, hid the group
    // from its own creator, and blocked them posting to it. Found by driving
    // the real app, not by the rules suite.
    as: ADMIN_U,
    seed: async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', 'fresh-group'), {
        name: 'Fresh',
        inviteCode: 'FRESH1',
        adminUid: ADMIN_U.uid,
        memberCount: 1,
      });
    },
    run: (db) =>
      setDoc(doc(db, 'groups', 'fresh-group', 'members', ADMIN_U.uid), {
        uid: ADMIN_U.uid,
        joinedAt: '2026-08-21T00:00:00.000Z',
      }),
  },
  {
    name: 'a non-admin still cannot add themselves without a proof',
    expect: 'deny',
    killedBy: 'M76',
    as: OUTSIDER,
    seed: async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', 'fresh-group'), {
        name: 'Fresh',
        inviteCode: 'FRESH1',
        adminUid: ADMIN_U.uid,
        memberCount: 1,
      });
    },
    run: (db) =>
      setDoc(doc(db, 'groups', 'fresh-group', 'members', OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-21T00:00:00.000Z',
      }),
  },

  // --- joining --------------------------------------------------------------
  {
    name: 'a non-member with a valid proof may create their membership',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedWithProof,
    run: (db) =>
      setDoc(memberRef(db, OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'a non-member without a proof cannot create their membership',
    expect: 'deny',
    killedBy: 'M20',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) =>
      setDoc(memberRef(db, OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'a caller cannot create a membership for someone else',
    expect: 'deny',
    killedBy: 'M41',
    as: OUTSIDER,
    seed: seedWithProof,
    run: (db) =>
      setDoc(memberRef(db, 'someone-else'), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'a membership document cannot carry extra fields',
    expect: 'deny',
    killedBy: 'M42',
    as: OUTSIDER,
    seed: seedWithProof,
    run: (db) =>
      setDoc(memberRef(db, OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
        admin: true,
      }),
  },

  // --- memberCount ----------------------------------------------------------
  {
    name: 'the count may go up by one once the membership exists',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedJoined,
    run: (db) => updateDoc(groupRef(db), { memberCount: increment(1) }),
  },
  {
    name: 'the count cannot go up without a membership document',
    expect: 'deny',
    killedBy: 'M43',
    // Otherwise the count is just a number anyone can inflate.
    as: OUTSIDER,
    seed: seedWithProof,
    run: (db) => updateDoc(groupRef(db), { memberCount: increment(1) }),
  },
  {
    name: 'the count may go down by one once the membership is gone',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedWithProof,
    run: (db) => updateDoc(groupRef(db), { memberCount: increment(-1) }),
  },
  {
    name: 'the count cannot jump by more than one',
    expect: 'deny',
    killedBy: 'M43',
    as: OUTSIDER,
    seed: seedJoined,
    run: (db) => updateDoc(groupRef(db), { memberCount: increment(50) }),
  },
  {
    name: 'a count change cannot smuggle a rename alongside it',
    expect: 'deny',
    killedBy: 'M44',
    as: OUTSIDER,
    seed: seedJoined,
    run: (db) =>
      updateDoc(groupRef(db), { memberCount: increment(1), name: 'Hijacked' }),
  },

  // --- leaving --------------------------------------------------------------
  {
    name: 'a member may delete their own membership',
    expect: 'allow',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => deleteDoc(memberRef(db, MEMBER.uid)),
  },
  {
    name: "a member cannot delete another member's membership",
    expect: 'deny',
    killedBy: 'M45',
    as: MEMBER,
    seed: seedGroup,
    run: (db) => deleteDoc(memberRef(db, OUTSIDER.uid)),
  },
  {
    name: 'the group admin may remove a member',
    expect: 'allow',
    // The array design had no kick path at all.
    as: ADMIN_U,
    seed: seedJoined,
    run: (db) => deleteDoc(memberRef(db, OUTSIDER.uid)),
  },

  // --- creation -------------------------------------------------------------
  {
    name: 'a group is created with a count of one and no members array',
    expect: 'allow',
    as: ADMIN_U,
    run: (db) =>
      setDoc(doc(db, 'groups', 'brand-new'), {
        name: 'New',
        inviteCode: 'NEW001',
        adminUid: ADMIN_U.uid,
        memberCount: 1,
      }),
  },
  {
    name: 'a group cannot be created carrying a members array',
    expect: 'deny',
    killedBy: 'M46',
    // Belt and braces: the array must not come back by the side door.
    as: ADMIN_U,
    run: (db) =>
      setDoc(doc(db, 'groups', 'brand-new'), {
        name: 'New',
        inviteCode: 'NEW001',
        adminUid: ADMIN_U.uid,
        memberCount: 1,
        members: [ADMIN_U.uid, 'someone-else'],
      }),
  },
  {
    name: 'a group cannot be created with an inflated count',
    expect: 'deny',
    killedBy: 'M46',
    as: ADMIN_U,
    run: (db) =>
      setDoc(doc(db, 'groups', 'brand-new'), {
        name: 'New',
        inviteCode: 'NEW001',
        adminUid: ADMIN_U.uid,
        memberCount: 500,
      }),
  },
  // --- join-by-code pre-check (found by the player bots) ------------------
  {
    name: 'a non-member can check their own (missing) membership before joining',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => getDoc(doc(db, 'groups', GID, 'members', OUTSIDER.uid)),
  },
  {
    name: "a user cannot probe whether someone else is a member",
    expect: 'deny',
    killedBy: 'M77',
    as: OUTSIDER,
    seed: seedGroup,
    run: (db) => getDoc(doc(db, 'groups', GID, 'members', MEMBER.uid)),
  },
];
