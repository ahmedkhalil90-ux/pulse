import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv } from './helpers/env';
import { INVITE, seedInvite } from './helpers/fixtures';

/**
 * End-to-end lookup flows against the real ruleset, walking the same sequence
 * AuthProvider walks. These exist because `users` is no longer listable: if a
 * mapping write is refused, signup or referral redemption breaks, and the
 * per-rule cases would not catch the ordering.
 */
const ALICE = { uid: 'alice-uid', email: 'alice@pulse.app' };
const BOB = { uid: 'bob-uid', email: 'bob@pulse.app' };
/** Alice signing up again under a new UID -- the migration case. */
const ALICE_NEW = { uid: 'alice-new-uid', email: 'alice@pulse.app' };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv('pulse-lookupflows');
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  // Sign-up is invite-only: every client-created profile below names this code.
  await env.withSecurityRulesDisabled((ctx) => seedInvite(ctx));
});

const dbFor = (a: { uid: string; email: string }) =>
  env.authenticatedContext(a.uid, { email: a.email }).firestore();

describe('signup claims its lookups', () => {
  it('writes the profile, then both mappings, in order', async () => {
    const db = dbFor(ALICE);

    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE.uid), {
        username: 'alice',
        isVerified: true,
        credits: 13,
        referralCode: 'ALICE1',
        invitedWith: INVITE,
      }),
    );
    await assertSucceeds(setDoc(doc(db, 'usernames', 'alice'), { uid: ALICE.uid }));
    await assertSucceeds(
      setDoc(doc(db, 'referralCodes', 'ALICE1'), { uid: ALICE.uid }),
    );
  });

  it('refuses a referral mapping for a code the profile does not hold', async () => {
    const db = dbFor(ALICE);
    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE.uid), {
        username: 'alice',
        isVerified: true,
        credits: 13,
        referralCode: 'ALICE1',
        invitedWith: INVITE,
      }),
    );
    await assertFails(setDoc(doc(db, 'referralCodes', 'STOLEN'), { uid: ALICE.uid }));
  });

  it('refuses a username mapping the caller is not authenticated as', async () => {
    const db = dbFor(BOB);
    await assertSucceeds(
      setDoc(doc(db, 'users', BOB.uid), {
        username: 'bob',
        isVerified: true,
        credits: 0,
        referralCode: 'BOBBY1',
        invitedWith: INVITE,
      }),
    );
    await assertFails(setDoc(doc(db, 'usernames', 'alice'), { uid: BOB.uid }));
  });
});

describe('redeeming a referral', () => {
  it('resolves the referrer by code without listing users', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      await setDoc(doc(d, 'users', ALICE.uid), {
        username: 'alice',
        isVerified: true,
        credits: 13,
        referralCode: 'ALICE1',
      });
      await setDoc(doc(d, 'referralCodes', 'ALICE1'), { uid: ALICE.uid });
    });

    const db = dbFor(BOB);
    const snap = await assertSucceeds(getDoc(doc(db, 'referralCodes', 'ALICE1')));
    expect(snap.data()?.uid).toBe(ALICE.uid);

    // The old path is gone.
    await assertFails(getDocs(collection(db, 'users')));
  });
});

describe('sign-in migration re-points the mapping', () => {
  it('lets the same username under a new UID take the mapping over', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      await setDoc(doc(d, 'users', ALICE.uid), {
        username: 'alice',
        isVerified: true,
        credits: 13,
      });
      await setDoc(doc(d, 'usernames', 'alice'), { uid: ALICE.uid });
    });

    // Authenticated as alice@pulse.app, different UID -- exactly what the
    // sweep does after migrating the orphaned profile.
    const db = dbFor(ALICE_NEW);
    await assertSucceeds(
      setDoc(doc(db, 'usernames', 'alice'), { uid: ALICE_NEW.uid }),
    );
  });

  it('self-heals a missing mapping for an account that predates it', async () => {
    // Every existing account is in this state: a profile, no mapping.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ALICE.uid), {
        username: 'alice',
        isVerified: true,
        credits: 13,
      });
    });

    const db = dbFor(ALICE);
    const before = await assertSucceeds(getDoc(doc(db, 'usernames', 'alice')));
    expect(before.exists()).toBe(false);

    await assertSucceeds(setDoc(doc(db, 'usernames', 'alice'), { uid: ALICE.uid }));
  });

  it('does not let anyone else take a mapping over', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'usernames', 'alice'), { uid: ALICE.uid });
    });

    await assertFails(
      setDoc(doc(dbFor(BOB), 'usernames', 'alice'), { uid: BOB.uid }),
    );
  });
});
