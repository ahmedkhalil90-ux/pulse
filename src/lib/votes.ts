import { doc, getDoc, increment, runTransaction, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { CREDIT_VALUES, reasonData, reasonRef } from './credits';
import type { UserDemographics } from '../types';

/**
 * Add one vote to results/{questionId}.
 *
 * A transaction, because the first vote CREATES the document: two people
 * casting the first vote at the same moment both saw "no document", both
 * wrote a fresh one, and every write after the first was refused by the rules
 * (a create-shaped write onto an existing document). Those voters kept an
 * answer record but their vote was never counted, and they could not retry.
 * Inside a transaction the losers are retried against the document the winner
 * created, and land as ordinary +1 updates.
 *
 * Only the create needs the transaction. Once the document exists, a plain
 * atomic increment is used: twenty voters in a transaction on one document
 * contend and exhaust their retries, while increments never conflict.
 *
 * The write shapes are unchanged from the previous inline code, so the
 * results rules (exactly +1, on the caller's own option and buckets) apply as
 * before. The answer record must already exist: the rules check it.
 */
export async function addVoteToResults(
  db: Firestore,
  questionId: string,
  optionIndex: 0 | 1,
  demographics: UserDemographics,
): Promise<void> {
  const ref = doc(db, 'results', questionId);
  const buckets = (['ageRange', 'gender', 'country'] as const).filter((k) => !!demographics[k]);

  const update: Record<string, unknown> = { [`counts.${optionIndex}`]: increment(1) };
  for (const k of buckets) update[`demographics.${k}.${demographics[k]}.${optionIndex}`] = increment(1);

  // Retry only on errors that guarantee nothing was written (an aborted
  // transaction, or a create refused because another voter created the
  // document first), so a retry can never count a vote twice.
  for (let attempt = 0; ; attempt++) {
    try {
      await writeOnce();
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      const definitelyNotWritten = code === 'aborted' || code === 'permission-denied' || code === 'failed-precondition';
      if (!definitelyNotWritten || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 300 * (attempt + 1)));
    }
  }

  async function writeOnce() {
    if ((await getDoc(ref)).exists()) {
      await updateDoc(ref, update);
      return;
    }
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        tx.update(ref, update);
      } else {
        const c = { '0': optionIndex === 0 ? 1 : 0, '1': optionIndex === 1 ? 1 : 0 };
        const demo: Record<string, Record<string, typeof c>> = { ageRange: {}, gender: {}, country: {} };
        for (const k of buckets) demo[k] = { [demographics[k] as string]: c };
        tx.set(ref, { counts: c, demographics: demo });
      }
    });
  }
}

/**
 * The whole act of answering, as one write: the answer record, the +1 vote,
 * the +1 credit and the credit reason. The rules accept a vote and a credit
 * only in the same write that creates the answer record, so neither can be
 * replayed. When the results document already exists the write is a batch of
 * atomic increments (no contention between voters); only the first vote on a
 * question needs a transaction, to create the document.
 */
export async function castVote(
  db: Firestore,
  uid: string,
  questionId: string,
  optionIndex: 0 | 1,
  demographics: UserDemographics,
  answerData: Record<string, unknown>,
): Promise<void> {
  const resultsRef = doc(db, 'results', questionId);
  const answerRef = doc(db, 'user_answers', `${uid}_${questionId}`);
  const userRef = doc(db, 'users', uid);
  const buckets = (['ageRange', 'gender', 'country'] as const).filter((k) => !!demographics[k]);
  const update: Record<string, unknown> = { [`counts.${optionIndex}`]: increment(1) };
  for (const k of buckets) update[`demographics.${k}.${demographics[k]}.${optionIndex}`] = increment(1);
  const credit = { credits: increment(CREDIT_VALUES.ANSWER) };

  for (let attempt = 0; ; attempt++) {
    try {
      if ((await getDoc(resultsRef)).exists()) {
        const b = writeBatch(db);
        b.set(answerRef, answerData);
        b.update(resultsRef, update);
        b.update(userRef, credit);
        b.set(reasonRef(db, uid), reasonData('answer', questionId));
        await b.commit();
        return;
      }
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(resultsRef);
        tx.set(answerRef, answerData);
        if (snap.exists()) tx.update(resultsRef, update);
        else {
          const c = { '0': optionIndex === 0 ? 1 : 0, '1': optionIndex === 1 ? 1 : 0 };
          const demo: Record<string, Record<string, typeof c>> = { ageRange: {}, gender: {}, country: {} };
          for (const k of buckets) demo[k] = { [demographics[k] as string]: c };
          tx.set(resultsRef, { counts: c, demographics: demo });
        }
        tx.update(userRef, credit);
        tx.set(reasonRef(db, uid), reasonData('answer', questionId));
      });
      return;
    } catch (e) {
      // Nothing was written by a refused or aborted write, so a retry cannot
      // count twice; a retry after a real success is refused by the rules.
      const code = (e as { code?: string }).code;
      if (!(code === 'aborted' || code === 'permission-denied' || code === 'failed-precondition') || attempt >= 5) throw e;
      if ((await getDoc(answerRef).catch(() => null))?.exists()) return; // our earlier attempt landed
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 300 * (attempt + 1)));
    }
  }
}
