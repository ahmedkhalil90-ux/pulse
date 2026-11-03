import { doc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';

/**
 * Fixture shapes mirror the real client writes:
 *   - answer id            src/App.tsx:989   `${uid}_${questionId}`
 *   - answer record        src/App.tsx:1003-1010
 *   - results doc          src/App.tsx:1038-1046
 *   - demographic values   src/App.tsx:363-382 ('25-34', 'Male', free-text country)
 */

export const QID = 'q1';

export const VOTER = { uid: 'voter1', email: 'voter1@pulse.app' };
export const VOTER2 = { uid: 'voter2', email: 'voter2@pulse.app' };
/** A voter with no demographics, so demographic clauses stay out of the way. */
export const PLAIN = { uid: 'plain1', email: 'plain1@pulse.app' };
export const AUTHOR = { uid: 'author1', email: 'author1@pulse.app' };
export const FLAGGER = { uid: 'flagger1', email: 'flagger1@pulse.app' };
export const OWNER = { uid: 'owner1', email: 'owner1@pulse.app' };
export const ATTACKER = { uid: 'attacker1', email: 'attacker@pulse.app' };
/** Orphaned profile under a previous UID, username 'victim'. */
export const OLD_UID = 'olduid1';
export const NEW_UID = { uid: 'newuid1', email: 'victim@pulse.app' };

export type Demographics = { ageRange?: string; gender?: string; country?: string };

export const DEMOS: Required<Demographics> = {
  ageRange: '25-34',
  gender: 'Male',
  country: 'UAE',
};

export async function seedUser(
  ctx: RulesTestContext,
  uid: string,
  extra: { username?: string; demographics?: Demographics; credits?: number } = {},
) {
  await setDoc(doc(ctx.firestore(), 'users', uid), {
    username: extra.username ?? uid,
    isVerified: true,
    credits: extra.credits ?? 0,
    ...(extra.demographics ? { demographics: extra.demographics } : {}),
  });
}

export async function seedAnswer(
  ctx: RulesTestContext,
  uid: string,
  questionId: string,
  answerIndex: number,
) {
  await setDoc(doc(ctx.firestore(), 'user_answers', `${uid}_${questionId}`), {
    userId: uid,
    questionId,
    answerIndex,
    answeredAt: '2026-08-19T00:00:00.000Z',
    option0PercentAtTime: 50,
    option1PercentAtTime: 50,
  });
}

export async function seedResults(
  ctx: RulesTestContext,
  questionId: string,
  data: Record<string, unknown>,
) {
  await setDoc(doc(ctx.firestore(), 'results', questionId), data);
}

export async function seedQuestion(
  ctx: RulesTestContext,
  questionId: string,
  overrides: Record<string, unknown> = {},
) {
  await setDoc(doc(ctx.firestore(), 'questions', questionId), {
    text: 'Coffee or tea?',
    options: ['Coffee', 'Tea'],
    category: 'general',
    authorUid: AUTHOR.uid,
    isPublic: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    status: 'live',
    flags: 0,
    flags_unclear: 0,
    flags_inappropriate: 0,
    boostCount: 0,
    ...overrides,
  });
}

/** An inviter who has unlocked inviting (holds a member number), and their code. */
export const INVITER_UID = 'inviter1';
export const INVITE = 'INVITE1';
export async function seedInvite(ctx: RulesTestContext, extra: Record<string, unknown> = {}) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', INVITER_UID), { username: 'inviter', credits: 0, referralCode: INVITE, memberNumber: 1 });
  await setDoc(doc(db, 'referralCodes', INVITE), { uid: INVITER_UID, ...extra });
}
