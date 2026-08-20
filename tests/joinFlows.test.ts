import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
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
      members: [HOST.uid],
      createdAt: '2026-08-19T00:00:00.000Z',
    }),
  );
}

describe('join a group by code', () => {
  it('a non-member with the correct code can find, prove, and join', async () => {
    await createGroup();
    const db = joinerDb();

    // 1. Find it by code, exactly as handleJoin does.
    const found = await assertSucceeds(
      getDocs(query(collection(db, 'groups'), where('inviteCode', '==', GROUP_CODE))),
    );
    expect(found.empty).toBe(false);

    // 2. Stage proof of the code.
    await assertSucceeds(
      setDoc(doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid), {
        code: GROUP_CODE,
      }),
    );

    // 3. Add self to members.
    await assertSucceeds(
      updateDoc(doc(db, 'groups', 'flowgroup'), { members: arrayUnion(JOINER.uid) }),
    );
  });

  it('a member who left can rejoin with the same code', async () => {
    await createGroup();
    const db = joinerDb();
    const proof = doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid);
    const group = doc(db, 'groups', 'flowgroup');

    await assertSucceeds(setDoc(proof, { code: GROUP_CODE }));
    await assertSucceeds(updateDoc(group, { members: arrayUnion(JOINER.uid) }));

    await assertSucceeds(updateDoc(group, { members: arrayRemove(JOINER.uid) }));

    // Rejoining re-stages the proof. setDoc over the existing document is an
    // update, not a create -- the path that previously locked the user out.
    await assertSucceeds(setDoc(proof, { code: GROUP_CODE }));
    await assertSucceeds(updateDoc(group, { members: arrayUnion(JOINER.uid) }));
  });

  it('a retry after a failed members write can re-stage its proof', async () => {
    await createGroup();
    const db = joinerDb();
    const proof = doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid);

    await assertSucceeds(setDoc(proof, { code: GROUP_CODE }));
    // Second attempt writes the proof again before retrying the join.
    await assertSucceeds(setDoc(proof, { code: GROUP_CODE }));
    await assertSucceeds(
      updateDoc(doc(db, 'groups', 'flowgroup'), { members: arrayUnion(JOINER.uid) }),
    );
  });

  it('a wrong code is rejected at the proof step, and the join then fails', async () => {
    await createGroup();
    const db = joinerDb();

    await assertFails(
      setDoc(doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid), {
        code: 'NOPE99',
      }),
    );

    // Without proof the members write is refused too.
    await assertFails(
      updateDoc(doc(db, 'groups', 'flowgroup'), { members: arrayUnion(JOINER.uid) }),
    );
  });

  it('a non-member cannot rename the group even holding a valid proof', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(
      setDoc(doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid), {
        code: GROUP_CODE,
      }),
    );

    await assertFails(updateDoc(doc(db, 'groups', 'flowgroup'), { name: 'Hijacked' }));
    await assertFails(
      updateDoc(doc(db, 'groups', 'flowgroup'), { adminUid: JOINER.uid }),
    );
    await assertFails(
      updateDoc(doc(db, 'groups', 'flowgroup'), { inviteCode: 'STOLEN' }),
    );
  });

  it('a non-member cannot join and rename in the same well-formed write', async () => {
    await createGroup();
    const db = joinerDb();

    await assertSucceeds(
      setDoc(doc(db, 'groups', 'flowgroup', 'joinRequests', JOINER.uid), {
        code: GROUP_CODE,
      }),
    );

    await assertFails(
      updateDoc(doc(db, 'groups', 'flowgroup'), {
        members: arrayUnion(JOINER.uid),
        name: 'Hijacked',
      }),
    );
  });
});
