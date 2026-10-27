/**
 * SWARM BOTS: many users acting at the same moment, through the real rules.
 * Catches races that single-user tests cannot: lost votes, double credits,
 * overdrafts, double-scored game questions.
 */
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { awardDailyBonus, unlockDemographics } from '../src/lib/credits';
import { advanceQuestion, startGame } from '../src/lib/gameState';
import type { Game } from '../src/types';
import { clientVote } from './lib/clientVote';
import { botsFor, readAsAdmin, seedGame, seedQuestion, seedUsers, world } from './lib/world';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await world('pulse-swarm'); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const total = (r?: { counts?: Record<string, number> }) => (r?.counts?.['0'] ?? 0) + (r?.counts?.['1'] ?? 0);

describe('swarm: feed votes', () => {
  it('20 bots voting at once on a question with existing results: every vote counted', async () => {
    const bots = botsFor(env, 21);
    await seedUsers(env, bots);
    await seedQuestion(env, 'q_busy');
    await clientVote(bots[0], 'q_busy', 0); // results doc now exists
    const swarm = bots.slice(1);
    const outcomes = await Promise.allSettled(swarm.map((b, i) => clientVote(b, 'q_busy', (i % 2) as 0 | 1)));
    const failed = outcomes.filter(o => o.status === 'rejected').length;
    const results = await readAsAdmin<{ counts: Record<string, number> }>(env, 'results/q_busy');
    expect({ failed, counted: total(results) }).toEqual({ failed: 0, counted: 21 });
  });

  it('10 bots casting the FIRST votes on a fresh question at once: no vote lost', async () => {
    const bots = botsFor(env, 10);
    await seedUsers(env, bots);
    await seedQuestion(env, 'q_fresh');
    const outcomes = await Promise.allSettled(bots.map((b, i) => clientVote(b, 'q_fresh', (i % 2) as 0 | 1)));
    const failed = outcomes.filter(o => o.status === 'rejected').length;
    const answered = (await Promise.all(bots.map(b => readAsAdmin(env, `user_answers/${b.uid}_q_fresh`)))).filter(Boolean).length;
    const results = await readAsAdmin<{ counts: Record<string, number> }>(env, 'results/q_fresh');
    // Every bot that holds an answer record must be counted exactly once.
    expect({ failed, answered, counted: total(results) }).toEqual({ failed: 0, answered: 10, counted: 10 });
  });

  it('every voter earns exactly +1 credit', async () => {
    const bots = botsFor(env, 8);
    await seedUsers(env, bots, 0);
    await seedQuestion(env, 'q_credit');
    await clientVote(bots[0], 'q_credit', 1);
    await Promise.allSettled(bots.slice(1).map(b => clientVote(b, 'q_credit', 0)));
    const credits = await Promise.all(bots.map(async b => (await readAsAdmin<{ credits: number }>(env, `users/${b.uid}`))?.credits));
    expect(credits).toEqual(bots.map(() => 1));
  });
});

describe('swarm: credit races', () => {
  it('one user firing 5 unlocks at once with 3 credits: one unlock, balance never negative', async () => {
    const [bot] = botsFor(env, 1, 'spender');
    await seedUsers(env, [bot], 3);
    const qs = ['u1', 'u2', 'u3', 'u4', 'u5'];
    for (const q of qs) await seedQuestion(env, q);
    await Promise.allSettled(qs.map(q => unlockDemographics(bot.db, bot.uid, q)));
    const user = await readAsAdmin<{ credits: number }>(env, `users/${bot.uid}`);
    const unlocked = (await Promise.all(qs.map(q => readAsAdmin(env, `users/${bot.uid}/unlockedDemographics/${q}`)))).filter(Boolean).length;
    expect({ credits: user?.credits, unlocked }).toEqual({ credits: 0, unlocked: 1 });
  });

  it('daily bonus claimed from 5 devices at once: +3 exactly once', async () => {
    const [bot] = botsFor(env, 1, 'daily');
    await seedUsers(env, [bot], 0);
    await env.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore() as never, 'users', bot.uid), { lastLogin: '2026-10-26T08:00:00.000Z' });
    });
    await Promise.allSettled(Array.from({ length: 5 }, () => awardDailyBonus(bot.db, bot.uid, '2026-10-27')));
    const user = await readAsAdmin<{ credits: number }>(env, `users/${bot.uid}`);
    expect(user?.credits).toBe(3);
  });
});

describe('swarm: a full 4-player live game', () => {
  it('plays 2 questions end to end, scores match the rules, double-advance is harmless', async () => {
    const players = botsFor(env, 4, 'player');
    await seedUsers(env, players);
    const host = players[0];
    const game: Game = {
      id: 'g_swarm', type: 'live', status: 'lobby', hostUid: host.uid, players: players.map(p => p.uid),
      questions: ['gq1', 'gq2'], currentQuestionIndex: 0, scores: {}, predictions: {}, answers: {},
      playerQuestions: {}, inviteCode: 'ABC123', questionsPerPlayer: 1, createdAt: new Date().toISOString(),
    };
    await seedGame(env, game);
    await startGame(host.db, 'g_swarm', host.uid);

    // gq1: 3 pick option 0 (majority 0); players 0 and 1 predict 0, 2 and 3 predict 1.
    // gq2: 2-2 split (perfectly divided): nobody scores.
    const plan: Record<string, { a: number[]; p: number[] }> = {
      gq1: { a: [0, 0, 0, 1], p: [0, 0, 1, 1] },
      gq2: { a: [0, 1, 0, 1], p: [0, 0, 0, 0] },
    };
    for (const qid of ['gq1', 'gq2']) {
      await Promise.all(players.map((pl, i) => updateDoc(doc(pl.db, 'games', 'g_swarm'), {
        [`answers.${pl.uid}.${qid}`]: plan[qid].a[i],
      })));
      await Promise.all(players.map((pl, i) => updateDoc(doc(pl.db, 'games', 'g_swarm'), {
        [`predictions.${pl.uid}.${qid}`]: plan[qid].p[i],
      })));
      // Host double-taps "next": the second advance must not double-score.
      await Promise.allSettled([
        advanceQuestion(host.db, 'g_swarm', qid, host.uid),
        advanceQuestion(host.db, 'g_swarm', qid, host.uid),
      ]);
    }
    const final = (await getDoc(doc(host.db, 'games', 'g_swarm'))).data() as Game;
    expect(final.status).toBe('finished');
    const scores = Object.fromEntries(players.map(p => [p.uid, final.scores?.[p.uid] ?? 0]));
    expect(scores).toEqual({ player0: 1, player1: 1, player2: 0, player3: 0 });
  });
});
