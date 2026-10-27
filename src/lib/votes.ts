import { doc, getDoc, increment, runTransaction, updateDoc, type Firestore } from 'firebase/firestore';
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
