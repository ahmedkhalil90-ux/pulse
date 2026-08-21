import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv } from './helpers/env';

/**
 * End-to-end join flows, against the real ruleset, with two separate auth
 * contexts per test. These replace the manual browser smoke test: each one
 * walks the same sequence the client walks, so a rule that is too tight for a
 * real user fails here rather than in someone's hands.
 *
 *   game join  -- GameHome.joinGame:  query by inviteCode + status
 *                                     -> updateDoc players arrayUnion(self)
 *   group join -- App.tsx handleJoin: query by inviteCode
 *                                     -> setDoc joinRequests proof
 *                                     -> updateDoc members arrayUnion(self)
 */
const HOST = { uid: 'flowhost', email: 'flowhost@pulse.app' };
const JOINER = { uid: 'flowjoiner', email: 'flowjoiner@pulse.app' };

const GAME_CODE = 'GAME99';
const GROUP_CODE = 'GRUP99';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv('pulse-joinflows');
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const hostDb = () => env.authenticatedContext(HOST.uid, { email: HOST.email }).firestore();
const joinerDb = () =>
  env.authenticatedContext(JOINER.uid, { email: JOINER.email }).firestore();

// --- game -------------------------------------------------------------------

async function createGame(status: string) {
  // Seeded past the create rule so the test targets the join, not creation.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'games', 'flowgame'), {
      type: 'live',
      status,
      hostUid: HOST.uid,
      players: [HOST.uid],
      questions: ['fq1'],
      currentQuestionIndex: 0,
      inviteCode: GAME_CODE,
      questionsPerPlayer: 1,
      createdAt: '2026-08-19T00:00:00.000Z',
      scores: {},
      answers: { [HOST.uid]: { fq1: 1 } },
      predictions: { [HOST.uid]: { fq1: 0 } },
    });
  });
}

describe('join a game by code', () => {
  it('a second player can find and join a lobby game', async () => {
    await createGame('lobby');
    const db = joinerDb();

    // 1. Find it by code, exactly as GameHome does.
    const found = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'games'),
          where('inviteCode', '==', GAME_CODE),
          where('status', '==', 'lobby'),
          limit(1),
        ),
      ),
    );
    expect(found.empty).toBe(false);

    // 2. Add self to players.
    await assertSucceeds(
      updateDoc(doc(db, 'games', 'flowgame'), {
        players: arrayUnion(JOINER.uid),
        [`scores.${JOINER.uid}`]: 0,
      }),
    );
  });

  it('the host can still read their own lobby game', async () => {
    await createGame('lobby');
    await assertSucceeds(
      getDocs(
        query(collection(hostDb(), 'games'), where('players', 'array-contains', HOST.uid)),
      ),
    );
  });

  it('a non-player cannot read an active game', async () => {
    await createGame('active');
    await assertFails(
      getDocs(
        query(
          collection(joinerDb(), 'games'),
          where('inviteCode', '==', GAME_CODE),
          limit(1),
        ),
      ),
    );
  });

  it('a non-player cannot join a game that has already started', async () => {
    await createGame('active');
    await assertFails(
      updateDoc(doc(joinerDb(), 'games', 'flowgame'), {
        players: arrayUnion(JOINER.uid),
        [`scores.${JOINER.uid}`]: 0,
      }),
    );
  });

  it('a non-player cannot join a finished game', async () => {
    await createGame('finished');
    await assertFails(
      updateDoc(doc(joinerDb(), 'games', 'flowgame'), {
        players: arrayUnion(JOINER.uid),
      }),
    );
  });
});

// --- group ------------------------------------------------------------------

async function createGroup() {
  await assertSucceeds(
    setDoc(doc(hostDb(), 'groups', 'flowgroup'), {
      name: 'Flow Club',
      description: '',
      inviteCode: GROUP_CODE,
      adminUid: HOST.uid,
      memberCount: 1,
      createdAt: '2026-08-19T00:00:00.000Z',
    }),
  );
}

describe('join a group by code', () => {
  const proofRef = (db: any) =>
    doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid);
  const memberRef = (db: any, uid: string) =>
    doc(db, 'groups', 'flowgroup', 'members', uid);
  const groupRef = (db: any) => doc(db, 'groups', 'flowgroup');

  it('a non-member with the correct code can find, prove, join, and count', async () => {
    await createGroup();
    const db = joinerDb();

    // 1. Find it by code, exactly as handleJoin does.
    const found = await assertSucceeds(
      getDocs(query(collection(db, 'groups'), where('inviteCode', '==', GROUP_CODE))),
    );
    expect(found.empty).toBe(false);

    // 2. Stage proof of the code.
    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));

    // 3. Create your membership document.
    await assertSucceeds(
      setDoc(memberRef(db, JOINER.uid), {
        uid: JOINER.uid,
        joinedAt: '2026-08-20T00:00:00.000Z',
      }),
    );

    // 4. Bump the count, which the rule ties to that document existing.
    await assertSucceeds(updateDoc(groupRef(db), { memberCount: increment(1) }));
  });

  it('a member who left can rejoin with the same code', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));
    await assertSucceeds(
      setDoc(memberRef(db, JOINER.uid), { uid: JOINER.uid, joinedAt: 'x' }),
    );
    await assertSucceeds(updateDoc(groupRef(db), { memberCount: increment(1) }));

    // Leave.
    await assertSucceeds(deleteDoc(memberRef(db, JOINER.uid)));
    await assertSucceeds(updateDoc(groupRef(db), { memberCount: increment(-1) }));

    // Rejoin. setDoc over the existing proof is an update, not a create.
    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));
    await assertSucceeds(
      setDoc(memberRef(db, JOINER.uid), { uid: JOINER.uid, joinedAt: 'y' }),
    );
    await assertSucceeds(updateDoc(groupRef(db), { memberCount: increment(1) }));
  });

  it('a wrong code is rejected at the proof step, and the join then fails', async () => {
    await createGroup();
    const db = joinerDb();

    await assertFails(setDoc(proofRef(db), { code: 'NOPE99' }));
    await assertFails(
      setDoc(memberRef(db, JOINER.uid), { uid: JOINER.uid, joinedAt: 'x' }),
    );
    // And the count cannot move without the membership document.
    await assertFails(updateDoc(groupRef(db), { memberCount: increment(1) }));
  });

  it('a non-member cannot rename the group even holding a valid proof', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));

    await assertFails(updateDoc(groupRef(db), { name: 'Hijacked' }));
    await assertFails(updateDoc(groupRef(db), { adminUid: JOINER.uid }));
    await assertFails(updateDoc(groupRef(db), { inviteCode: 'STOLEN' }));
  });

  it('a joiner cannot bump the count and rename in one write', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));
    await assertSucceeds(
      setDoc(memberRef(db, JOINER.uid), { uid: JOINER.uid, joinedAt: 'x' }),
    );

    await assertFails(
      updateDoc(groupRef(db), { memberCount: increment(1), name: 'Hijacked' }),
    );
  });

  it('the roster stays private to each member', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(setDoc(proofRef(db), { code: GROUP_CODE }));
    await assertSucceeds(
      setDoc(memberRef(db, JOINER.uid), { uid: JOINER.uid, joinedAt: 'x' }),
    );

    // Own membership: fine. The host's: refused. The whole roster: refused.
    await assertSucceeds(getDoc(memberRef(db, JOINER.uid)));
    await assertFails(getDoc(memberRef(db, HOST.uid)));
    await assertFails(getDocs(collection(db, 'groups', 'flowgroup', 'members')));
  });
});