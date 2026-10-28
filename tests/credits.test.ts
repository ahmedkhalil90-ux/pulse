import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BOOST_IMPRESSIONS,
  CREDIT_VALUES,
  InsufficientCreditsError,
  awardAnswerCredit,
  awardDailyBonus,
  awardReferral,
  boostQuestion,
  dayKey,
  unlockDemographics,
} from '../src/lib/credits';
import { makeEnv } from './helpers/env';

/**
 * Credit economy, exercised against the emulator.
 *
 * These test application logic, not security rules, so the ruleset is open --
 * rules coverage lives in rules.test.ts.
 */
const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

const UID = 'creditor1';
const REFERRER = 'referrer1';
const QID = 'boostable1';

let env: RulesTestEnvironment;
let db: Firestore;

async function seed(credits: number, extra: Record<string, unknown> = {}) {
  await setDoc(doc(db, 'users', UID), {
    username: UID,
    isVerified: true,
    credits,
    ...extra,
  });
}

async function seedQuestion(id = QID, boostCount = 0) {
  await setDoc(doc(db, 'questions', id), {
    text: 'Coffee or tea?',
    options: ['Coffee', 'Tea'],
    authorUid: UID,
    boostCount,
  });
}

async function credits(uid = UID): Promise<number> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.data()?.credits as number;
}

beforeAll(async () => {
  env = await makeEnv('pulse-credits', OPEN_RULES);
  db = env.unauthenticatedContext().firestore() as unknown as Firestore;
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('credits never go below zero', () => {
  it('refuses a boost the caller cannot afford, and does not deduct', async () => {
    await seed(5);
    await seedQuestion();
    await expect(boostQuestion(db, UID, QID)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await credits()).toBe(5);
  });

  it('refuses an unlock the caller cannot afford, and does not deduct', async () => {
    await seed(2);
    await expect(unlockDemographics(db, UID, QID)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await credits()).toBe(2);
  });

  it('does not go negative when two boosts race on the same balance', async () => {
    // Two devices, both holding a snapshot showing 10 credits.
    await seed(10);
    await seedQuestion();

    await Promise.allSettled([boostQuestion(db, UID, QID), boostQuestion(db, UID, QID)]);

    expect(await credits()).toBeGreaterThanOrEqual(0);
  });

  it('does not go negative when two unlocks race on the same balance', async () => {
    await seed(3);
    await Promise.allSettled([
      unlockDemographics(db, UID, 'qA'),
      unlockDemographics(db, UID, 'qB'),
    ]);
    expect(await credits()).toBeGreaterThanOrEqual(0);
  });
});

describe('credit changes use atomic increments', () => {
  it('does not lose a concurrent answer award', async () => {
    await seed(0);
    await Promise.all([awardAnswerCredit(db, UID), awardAnswerCredit(db, UID)]);
    expect(await credits()).toBe(2 * CREDIT_VALUES.ANSWER);
  });

  it('credits the new user and records the referral in one commit', async () => {
    await seed(0);
    await setDoc(doc(db, 'users', REFERRER), {
      username: REFERRER,
      isVerified: true,
      credits: 7,
    });

    await awardReferral(db, UID, REFERRER, 'abc123');

    expect(await credits()).toBe(CREDIT_VALUES.REFERRAL);
    const rec = (await getDoc(doc(db, 'referrals', UID))).data();
    expect(rec).toMatchObject({ code: 'ABC123', referrerUid: REFERRER });
    // The referrer is credited server-side by scripts/ops/referrals.mjs.
    expect(await credits(REFERRER)).toBe(7);
  });
});

describe('daily login bonus', () => {
  it('awards +3 on the first open of the day', async () => {
    await seed(0);
    const awarded = await awardDailyBonus(db, UID, '2026-08-19');
    expect(awarded).toBe(true);
    expect(await credits()).toBe(CREDIT_VALUES.DAILY_BONUS);
  });

  it('does not award twice on the same calendar day', async () => {
    await seed(0);
    await awardDailyBonus(db, UID, '2026-08-19');
    const again = await awardDailyBonus(db, UID, '2026-08-19');
    expect(again).toBe(false);
    expect(await credits()).toBe(CREDIT_VALUES.DAILY_BONUS);
  });

  it('awards again the next calendar day', async () => {
    await seed(0);
    await awardDailyBonus(db, UID, '2026-08-19');
    await awardDailyBonus(db, UID, '2026-08-20');
    expect(await credits()).toBe(2 * CREDIT_VALUES.DAILY_BONUS);
  });

  it('is not awarded twice when two app opens race', async () => {
    // Two tabs open at once; both read the profile before either has written.
    await seed(0);
    await Promise.allSettled([
      awardDailyBonus(db, UID, '2026-08-19'),
      awardDailyBonus(db, UID, '2026-08-19'),
    ]);
    expect(await credits()).toBe(CREDIT_VALUES.DAILY_BONUS);
  });

  it('treats a full ISO timestamp as its calendar day', () => {
    expect(dayKey('2026-08-19T23:59:59.999Z')).toBe('2026-08-19');
  });
});

describe('demographic unlock is charged at most once per question', () => {
  it('deducts 3 on the first unlock', async () => {
    await seed(10);
    const charged = await unlockDemographics(db, UID, QID);

    expect(charged).toBe(true);
    expect(await credits()).toBe(10 + CREDIT_VALUES.UNLOCK_DEMOGRAPHICS);
    const unlock = await getDoc(doc(db, 'users', UID, 'unlockedDemographics', QID));
    expect(unlock.exists()).toBe(true);
  });

  it('does not charge again for a question already unlocked', async () => {
    await seed(10);
    await unlockDemographics(db, UID, QID);
    const afterFirst = await credits();

    const charged = await unlockDemographics(db, UID, QID);

    expect(charged).toBe(false);
    expect(await credits()).toBe(afterFirst);
  });

  it('does not charge twice when two unlocks of the same question race', async () => {
    await seed(10);
    await Promise.allSettled([
      unlockDemographics(db, UID, QID),
      unlockDemographics(db, UID, QID),
    ]);
    expect(await credits()).toBe(10 + CREDIT_VALUES.UNLOCK_DEMOGRAPHICS);
  });
});

describe('boost', () => {
  it('deducts exactly 10 and adds exactly 100 impressions', async () => {
    await seed(20);
    await seedQuestion();

    await boostQuestion(db, UID, QID);

    expect(await credits()).toBe(20 + CREDIT_VALUES.BOOST);
    const q = await getDoc(doc(db, 'questions', QID));
    expect(q.data()?.boostCount).toBe(BOOST_IMPRESSIONS);
  });

  it('does not deduct credits without also granting the impressions', async () => {
    await seed(20);
    // The question does not exist, so the boost cannot land.
    await Promise.allSettled([boostQuestion(db, UID, 'no-such-question')]);
    expect(await credits()).toBe(20);
  });
});
