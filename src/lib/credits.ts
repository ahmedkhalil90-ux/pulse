import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

/**
 * Credit economy operations.
 *
 * Extracted from the component closures in App.tsx / AuthProvider.tsx so the
 * arithmetic can be exercised against the emulator. Values match the table in
 * CLAUDE.md. Posting a question is free and deliberately has no entry here.
 *
 * Every deduction runs inside a transaction: the balance is read and the
 * increment applied in the same atomic unit, so a stale client-side balance
 * can never drive credits below zero. Unconditional awards stay plain atomic
 * increments -- there is nothing to check.
 */
export const CREDIT_VALUES = {
  ANSWER: 1,
  /** Completing a Knockout bracket (approved by Ahmed, 2026-11-09). */
  BRACKET: 1,
  DAILY_BONUS: 3,
  REFERRAL: 15,
  BOOST: -10,
  UNLOCK_DEMOGRAPHICS: -3,
} as const;

/** Impressions granted by one boost. */
export const BOOST_IMPRESSIONS = 100;

export class InsufficientCreditsError extends Error {
  constructor(public readonly required: number) {
    super(`Not enough credits (${required} required)`);
    this.name = 'InsufficientCreditsError';
  }
}

/** Calendar day key, matching AuthProvider's `new Date().toISOString().split('T')[0]`. */
export function dayKey(when: Date | string = new Date()): string {
  const iso = typeof when === 'string' ? when : when.toISOString();
  return iso.split('T')[0];
}

/**
 * Why the balance moved. The rules only accept a credit change written in the
 * same transaction or batch as this record and the action it names (see
 * creditOk in firestore.rules), so every credit write below sets it.
 */
export type CreditReason = 'answer' | 'bracket' | 'unlock' | 'referral' | 'boost' | 'daily';
export const reasonRef = (db: Firestore, uid: string) => doc(db, 'users', uid, 'private', 'credit');
export const reasonData = (reason: CreditReason, ref = '') => ({ reason, ref, at: serverTimestamp() });

/**
 * +1 for answering a question. Not used by the app any more: the answer, the
 * vote and the credit are one write in castVote (src/lib/votes.ts), which is
 * what the rules require. Kept for the credit-economy tests.
 */
export async function awardAnswerCredit(db: Firestore, uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { credits: increment(CREDIT_VALUES.ANSWER) });
}


/**
 * +3 on the first app open of a calendar day.
 *
 * `lastLogin` is read inside the transaction rather than taken from the
 * caller's profile snapshot, so two tabs opening at once cannot both see a
 * stale value and both award the bonus.
 *
 * Returns whether the bonus was awarded.
 */
export async function awardDailyBonus(
  db: Firestore,
  uid: string,
  today: string = dayKey(),
): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', uid);
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;

    const lastLogin = snap.data().lastLogin as string | undefined;
    if (lastLogin && dayKey(lastLogin) === today) return false;

    tx.update(ref, {
      credits: increment(CREDIT_VALUES.DAILY_BONUS),
      lastLogin: today,
    });
    tx.set(reasonRef(db, uid), reasonData('daily'));
    return true;
  });
}

/**
 * -10 from the booster, +100 impressions on the question, in one transaction.
 *
 * Both halves land together or neither does, so a failed impressions write can
 * never leave the user charged for nothing.
 */
export async function boostQuestion(
  db: Firestore,
  uid: string,
  questionId: string,
): Promise<void> {
  const cost = -CREDIT_VALUES.BOOST;
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const questionRef = doc(db, 'questions', questionId);

    const [userSnap, questionSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(questionRef),
    ]);
    if (!userSnap.exists()) throw new Error(`No such user: ${uid}`);
    if (!questionSnap.exists()) throw new Error(`No such question: ${questionId}`);

    const balance = (userSnap.data().credits as number) ?? 0;
    if (balance < cost) throw new InsufficientCreditsError(cost);

    tx.update(userRef, { credits: increment(CREDIT_VALUES.BOOST) });
    tx.update(questionRef, { boostCount: increment(BOOST_IMPRESSIONS) });
    tx.set(reasonRef(db, uid), reasonData('boost', questionId));
  });
}

/**
 * -3 to unlock one question's demographic breakdown.
 *
 * Idempotent: a question already unlocked is never charged again, per
 * CLAUDE.md. Returns whether credits were actually deducted.
 */
export async function unlockDemographics(
  db: Firestore,
  uid: string,
  questionId: string,
): Promise<boolean> {
  const cost = -CREDIT_VALUES.UNLOCK_DEMOGRAPHICS;
  return runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const unlockRef = doc(db, 'users', uid, 'unlockedDemographics', questionId);

    const [userSnap, unlockSnap] = await Promise.all([tx.get(userRef), tx.get(unlockRef)]);
    if (unlockSnap.exists()) return false;
    if (!userSnap.exists()) throw new Error(`No such user: ${uid}`);

    const balance = (userSnap.data().credits as number) ?? 0;
    if (balance < cost) throw new InsufficientCreditsError(cost);

    tx.update(userRef, { credits: increment(CREDIT_VALUES.UNLOCK_DEMOGRAPHICS) });
    tx.set(unlockRef, { unlockedAt: new Date().toISOString() });
    tx.set(reasonRef(db, uid), reasonData('unlock', questionId));
    return true;
  });
}

/** +15 to both parties when a referral code is redeemed. */
export async function awardReferral(
  db: Firestore,
  newUserUid: string,
  referrerUid: string,
  code: string,
): Promise<void> {
  // The new user's +15 and the referral record land together. The referrer's
  // +15 is credited by the scheduled job (scripts/ops/referrals.mjs): rules
  // rightly refuse any client write to another user's credits, which is why
  // the old two-sided batch failed for everyone.
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', newUserUid), {
    credits: increment(CREDIT_VALUES.REFERRAL),
    // A flag, not the referrer's uid: profiles are readable by any member,
    // and the uid would expose who invited whom. The private referrals record
    // below is where the referrer is kept.
    referredBy: true,
  });
  batch.set(reasonRef(db, newUserUid), reasonData('referral'));
  batch.set(doc(db, 'referrals', newUserUid), {
    code: code.toUpperCase(),
    referrerUid,
    createdAt: new Date().toISOString(),
  });
  await batch.commit();
}
