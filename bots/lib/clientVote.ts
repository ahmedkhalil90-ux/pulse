/**
 * The feed vote as src/App.tsx performs it (QuestionCard.handleVote, first
 * answer): one write holding the answer record, the +1 vote and the +1 credit,
 * via the shared castVote.
 */
import { doc, getDoc } from 'firebase/firestore';
import { castVote } from '../../src/lib/votes';
import type { Bot } from './world';

export async function clientVote(bot: Bot, questionId: string, optionIndex: 0 | 1) {
  const { db, uid, demographics } = bot;
  const resultDoc = await getDoc(doc(db, 'results', questionId));
  const currentCounts = resultDoc.exists() ? resultDoc.data().counts : { '0': 0, '1': 0 };
  const total = (currentCounts['0'] || 0) + (currentCounts['1'] || 0);
  const p0 = total > 0 ? Math.round(((currentCounts['0'] || 0) / total) * 100) : 50;
  await castVote(db, uid, questionId, optionIndex, demographics, {
    userId: uid, questionId, answerIndex: optionIndex, answeredAt: new Date().toISOString(),
    option0PercentAtTime: p0, option1PercentAtTime: 100 - p0,
  });
}
