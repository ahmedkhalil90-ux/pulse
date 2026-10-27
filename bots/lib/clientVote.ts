/**
 * A line-for-line mirror of the feed vote in src/App.tsx (QuestionCard.handleVote,
 * first-answer path). The vote logic lives inside a React component, so the
 * swarm cannot call it directly. Keep this in sync until the logic is
 * extracted into src/lib and imported by both.
 */
import { doc, getDoc, increment, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { awardAnswerCredit } from '../../src/lib/credits';
import type { Bot } from './world';

export async function clientVote(bot: Bot, questionId: string, optionIndex: 0 | 1) {
  const { db, uid, demographics } = bot;
  const answerRef = doc(db, 'user_answers', `${uid}_${questionId}`);
  const resultRef = doc(db, 'results', questionId);
  const resultDoc = await getDoc(resultRef);
  const currentCounts = resultDoc.exists() ? resultDoc.data().counts : { '0': 0, '1': 0 };
  const total = (currentCounts['0'] || 0) + (currentCounts['1'] || 0);
  const p0 = total > 0 ? Math.round(((currentCounts['0'] || 0) / total) * 100) : 50;

  await setDoc(answerRef, {
    userId: uid, questionId, answerIndex: optionIndex, answeredAt: new Date().toISOString(),
    option0PercentAtTime: p0, option1PercentAtTime: 100 - p0,
  });

  const updateData: Record<string, unknown> = { [`counts.${optionIndex}`]: increment(1) };
  updateData[`demographics.ageRange.${demographics.ageRange}.${optionIndex}`] = increment(1);
  updateData[`demographics.gender.${demographics.gender}.${optionIndex}`] = increment(1);
  updateData[`demographics.country.${demographics.country}.${optionIndex}`] = increment(1);

  if (resultDoc.exists()) {
    await updateDoc(resultRef, updateData);
  } else {
    const c = { '0': optionIndex === 0 ? 1 : 0, '1': optionIndex === 1 ? 1 : 0 };
    await setDoc(resultRef, {
      counts: c,
      demographics: {
        ageRange: { [demographics.ageRange]: c },
        gender: { [demographics.gender]: c },
        country: { [demographics.country]: c },
      },
    });
  }
  await awardAnswerCredit(db as Firestore, uid);
}
