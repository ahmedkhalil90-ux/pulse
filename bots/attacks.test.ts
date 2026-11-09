/**
 * ATTACKER BOTS: signed-in users trying to cheat or de-anonymise, through the
 * real rules. Every attack must be DENIED. An attack that succeeds is a
 * finding, not a test to weaken.
 *
 * Known open gaps are listed in KNOWN_GAPS with it.fails(): the suite stays
 * green while the gap exists, and turns red the day it is fixed, so the entry
 * gets moved to the protected list instead of silently lingering.
 */
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, increment, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../src/types';
import { clientVote } from './lib/clientVote';
import { attempt, botsFor, seedGame, seedQuestion, seedUsers, world, type Bot } from './lib/world';

let env: RulesTestEnvironment;
let victim: Bot, mallory: Bot, friend: Bot, outsider: Bot;

beforeAll(async () => { env = await world('pulse-attacks'); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  [victim, mallory, friend, outsider] = botsFor(env, 4, 'actor');
  await seedUsers(env, [victim, mallory, friend, outsider], 5);
  await seedQuestion(env, 'q1');
  await clientVote(victim, 'q1', 1);
  const game: Game = {
    id: 'g1', type: 'live', status: 'active', hostUid: mallory.uid,
    players: [mallory.uid, victim.uid, friend.uid], questions: ['gq1', 'gq2'], currentQuestionIndex: 0,
    scores: {}, predictions: {}, answers: {}, playerQuestions: {}, inviteCode: 'XYZ789',
    questionsPerPlayer: 1, createdAt: new Date().toISOString(),
  };
  await seedGame(env, game);
  await updateDoc(doc(victim.db, 'games', 'g1'), { [`answers.${victim.uid}.gq1`]: 0 });
});

type Attack = { name: string; run: () => Promise<unknown> };

const ATTACKS: Attack[] = [
  // De-anonymisation
  { name: 'read another user\'s answer record', run: () => getDoc(doc(mallory.db, 'user_answers', `${victim.uid}_q1`)) },
  { name: 'list everyone\'s answers to a question', run: () => getDocs(query(collection(mallory.db, 'user_answers'), where('questionId', '==', 'q1'))) },
  { name: 'list another user\'s answer history', run: () => getDocs(query(collection(mallory.db, 'user_answers'), where('userId', '==', victim.uid))) },
  { name: 'list all user profiles', run: () => getDocs(collection(mallory.db, 'users')) },
  { name: 'non-player reads an active game', run: () => getDoc(doc(outsider.db, 'games', 'g1')) },
  // Credits and identity
  { name: 'make yourself admin', run: () => updateDoc(doc(mallory.db, 'users', mallory.uid), { role: 'admin' }) },
  { name: 'change another user\'s profile', run: () => updateDoc(doc(mallory.db, 'users', victim.uid), { credits: 0 }) },
  // Vote integrity
  { name: 'add votes to results without answering', run: () => updateDoc(doc(outsider.db, 'results', 'q1'), { 'counts.0': increment(50) }) },
  { name: 'overwrite the results document', run: () => setDoc(doc(mallory.db, 'results', 'q1'), { counts: { '0': 999, '1': 0 }, demographics: {} }) },
  { name: 'publish a public question straight to live, skipping moderation', run: () => setDoc(doc(mallory.db, 'questions', 'evil'), {
      text: 'x?', options: ['a', 'b'], category: 'x', authorUid: mallory.uid, isPublic: true,
      createdAt: new Date().toISOString(), status: 'live', flags: 0, random: 0.5 }) },
  { name: 'post a live question as the official Pulse Originals account', run: () => setDoc(doc(mallory.db, 'questions', 'fake_official'), {
      text: 'x?', options: ['a', 'b'], category: 'x', authorUid: 'pulse_originals_system', isPublic: true,
      createdAt: new Date().toISOString(), status: 'live', flags: 0, random: 0.5 }) },
  { name: 'grant yourself 1000 credits', run: () => updateDoc(doc(mallory.db, 'users', mallory.uid), { credits: increment(1000) }) },
  { name: 'claim an answer credit twice for the same question', run: () => updateDoc(doc(victim.db, 'users', victim.uid), { credits: increment(1) }) },
  { name: 'replay a genuine vote to inflate results', run: () => updateDoc(doc(victim.db, 'results', 'q1'), { 'counts.1': increment(1) }) },
  // Game integrity
  { name: 'write another player\'s game answer', run: () => updateDoc(doc(mallory.db, 'games', 'g1'), { [`answers.${friend.uid}.gq1`]: 1 }) },
  { name: 'outsider joins an active game', run: () => updateDoc(doc(outsider.db, 'games', 'g1'), { players: [mallory.uid, victim.uid, friend.uid, outsider.uid] }) },
  { name: 'player edits their own recorded game answer', run: () => updateDoc(doc(victim.db, 'games', 'g1'), { [`answers.${victim.uid}.gq1`]: 1 }) },
];

const KNOWN_GAPS: Attack[] = [
  // Need server-side code (the free Cloudflare Worker plan) or real phone auth; rules alone cannot close them.
  { name: 'host rewrites the scoreboard', run: () => updateDoc(doc(mallory.db, 'games', 'g1'), { scores: { [mallory.uid]: 99 } }) },
  { name: 'player reads other players\' game answers (shared game document)', run: async () => {
      const g = (await getDoc(doc(friend.db, 'games', 'g1'))).data() as Game;
      if (g.answers?.[victim.uid]?.gq1 === undefined) throw new Error('PERMISSION_DENIED: answer hidden');
    } },
  { name: 'self-verify phone without verification', run: () => updateDoc(doc(mallory.db, 'users', mallory.uid), { isVerified: true }) },
];

describe('attacker bots: must be denied', () => {
  for (const a of ATTACKS) {
    it(a.name, async () => { expect(await attempt(a.run)).toBe('denied'); });
  }
});

describe('attacker bots: KNOWN GAPS (succeed today; fix pending)', () => {
  for (const a of KNOWN_GAPS) {
    it.fails(a.name, async () => { expect(await attempt(a.run)).toBe('denied'); });
  }
});

// Sanity: the bots are not denied for ordinary use, or "denied" would prove nothing.
describe('attacker bots: control cases (legitimate actions allowed)', () => {
  it('a user reads their own answer record', async () => {
    expect(await attempt(() => getDoc(doc(victim.db, 'user_answers', `${victim.uid}_q1`)))).toBe('allowed');
  });
  it('a player reads their own game', async () => {
    expect(await attempt(() => getDoc(doc(friend.db, 'games', 'g1')))).toBe('allowed');
  });
  it('a player records their own first answer', async () => {
    expect(await attempt(() => updateDoc(doc(friend.db, 'games', 'g1'), { [`answers.${friend.uid}.gq1`]: 1 }))).toBe('allowed');
  });
});

