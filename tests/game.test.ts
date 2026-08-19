import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  isPerfectlyDivided,
  leaderboard,
  majorityOf,
  perfectlyDividedQuestions,
  scoreQuestion,
  tallyAnswers,
  winners,
} from '../src/lib/gameScoring';
import { advanceQuestion, resolvePhase, startGame } from '../src/lib/gameState';
import type { Game } from '../src/types';
import { makeEnv } from './helpers/env';

const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

const HOST = 'host1';
const P2 = 'player2';
const P3 = 'player3';
const PLAYERS = [HOST, P2, P3];
const GID = 'game1';

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: GID,
    type: 'live',
    status: 'lobby',
    hostUid: HOST,
    players: [...PLAYERS],
    questions: ['gq1', 'gq2'],
    currentQuestionIndex: 0,
    scores: {},
    predictions: {},
    answers: {},
    playerQuestions: { [HOST]: ['gq1'], [P2]: ['gq2'], [P3]: ['gq3'] },
    inviteCode: 'ABC123',
    questionsPerPlayer: 1,
    createdAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

let env: RulesTestEnvironment;
let db: Firestore;

beforeAll(async () => {
  env = await makeEnv('pulse-game', OPEN_RULES);
  db = env.unauthenticatedContext().firestore() as unknown as Firestore;
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

async function putGame(game: Game & { scoredQuestions?: string[] }) {
  const { id, ...data } = game;
  await setDoc(doc(db, 'games', id), data);
}

async function readGame(): Promise<Game & { scoredQuestions?: string[] }> {
  const snap = await getDoc(doc(db, 'games', GID));
  return { id: GID, ...snap.data() } as Game & { scoredQuestions?: string[] };
}

describe('prediction scoring', () => {
  const answers = {
    // Majority answered option 0 (2 votes vs 1).
    [HOST]: { gq1: 0 },
    [P2]: { gq1: 0 },
    [P3]: { gq1: 1 },
  };

  it('counts only real answers in the tally', () => {
    expect(tallyAnswers(PLAYERS, answers, 'gq1')).toEqual([2, 1]);
    expect(tallyAnswers(PLAYERS, answers, 'unanswered')).toEqual([0, 0]);
  });

  it('awards 1 point for a correct majority prediction', () => {
    const scores = scoreQuestion({
      players: PLAYERS,
      answers,
      predictions: { [HOST]: { gq1: 0 } },
      questionId: 'gq1',
      scores: {},
    });
    expect(scores[HOST]).toBe(1);
  });

  it('awards 0 for a wrong prediction', () => {
    const scores = scoreQuestion({
      players: PLAYERS,
      answers,
      predictions: { [P3]: { gq1: 1 } },
      questionId: 'gq1',
      scores: {},
    });
    expect(scores[P3] ?? 0).toBe(0);
  });

  it('awards 0 to everyone on a 50/50 split', () => {
    const evenAnswers = { [HOST]: { gq1: 0 }, [P2]: { gq1: 1 } };
    const scores = scoreQuestion({
      players: [HOST, P2],
      answers: evenAnswers,
      // Both players predicted; neither can be right.
      predictions: { [HOST]: { gq1: 0 }, [P2]: { gq1: 1 } },
      questionId: 'gq1',
      scores: {},
    });
    expect(scores).toEqual({});
    expect(majorityOf(tallyAnswers([HOST, P2], evenAnswers, 'gq1'))).toBeNull();
    expect(isPerfectlyDivided([1, 1])).toBe(true);
  });

  it('awards 0 for a skipped prediction', () => {
    const scores = scoreQuestion({
      players: PLAYERS,
      answers,
      predictions: {}, // nobody predicted
      questionId: 'gq1',
      scores: {},
    });
    expect(scores).toEqual({});
  });

  it('adds to an existing score rather than replacing it', () => {
    const scores = scoreQuestion({
      players: PLAYERS,
      answers,
      predictions: { [HOST]: { gq1: 0 } },
      questionId: 'gq1',
      scores: { [HOST]: 4 },
    });
    expect(scores[HOST]).toBe(5);
  });

  it('does not mutate the scores it was given', () => {
    const before = { [HOST]: 1 };
    scoreQuestion({
      players: PLAYERS,
      answers,
      predictions: { [HOST]: { gq1: 0 } },
      questionId: 'gq1',
      scores: before,
    });
    expect(before).toEqual({ [HOST]: 1 });
  });

  it('reports questions that ended perfectly divided', () => {
    const game = {
      players: [HOST, P2],
      questions: ['gq1', 'gq2'],
      answers: {
        [HOST]: { gq1: 0, gq2: 1 },
        [P2]: { gq1: 1, gq2: 1 },
      },
    };
    expect(perfectlyDividedQuestions(game as any)).toEqual(['gq1']);
  });
});

describe('Best Mind Reader', () => {
  const usernames = { [HOST]: 'Host', [P2]: 'Two', [P3]: 'Three' };

  it('ranks players by score, highest first', () => {
    const board = leaderboard(PLAYERS, usernames, { [HOST]: 1, [P2]: 3, [P3]: 2 });
    expect(board.map((r) => r.uid)).toEqual([P2, P3, HOST]);
  });

  it('names a single winner', () => {
    const board = leaderboard(PLAYERS, usernames, { [HOST]: 1, [P2]: 3, [P3]: 2 });
    expect(winners(board).map((r) => r.uid)).toEqual([P2]);
  });

  it('names every player tied at the top as joint winners', () => {
    const board = leaderboard(PLAYERS, usernames, { [HOST]: 3, [P2]: 3, [P3]: 1 });
    expect(winners(board).map((r) => r.uid).sort()).toEqual([HOST, P2].sort());
  });

  it('treats an all-zero game as a joint win for everyone', () => {
    const board = leaderboard(PLAYERS, usernames, {});
    expect(winners(board)).toHaveLength(3);
  });
});

describe('phase resolution', () => {
  it('shows the lobby before the game starts', () => {
    expect(resolvePhase(makeGame({ status: 'lobby' }), HOST)).toBe('lobby');
  });

  it('shows question submission until the player has submitted their quota', () => {
    const game = makeGame({ status: 'active', playerQuestions: { [HOST]: [] } });
    expect(resolvePhase(game, HOST)).toBe('submitting');
  });

  it('shows play once the player has submitted', () => {
    expect(resolvePhase(makeGame({ status: 'active' }), HOST)).toBe('playing');
  });

  it('shows results once every player has answered and predicted', () => {
    const game = makeGame({
      status: 'active',
      answers: { [HOST]: { gq1: 0 }, [P2]: { gq1: 1 }, [P3]: { gq1: 0 } },
      predictions: { [HOST]: { gq1: 0 }, [P2]: { gq1: 0 }, [P3]: { gq1: 0 } },
    });
    expect(resolvePhase(game, HOST)).toBe('results');
  });

  it('keeps a player on play while another has not predicted yet', () => {
    const game = makeGame({
      status: 'active',
      answers: { [HOST]: { gq1: 0 }, [P2]: { gq1: 1 }, [P3]: { gq1: 0 } },
      predictions: { [HOST]: { gq1: 0 }, [P2]: { gq1: 0 } },
    });
    expect(resolvePhase(game, HOST)).toBe('playing');
  });

  it('parks an async player who finished everything on waiting', () => {
    const game = makeGame({
      type: 'async',
      status: 'active',
      answers: { [HOST]: { gq1: 0, gq2: 1 } },
      predictions: { [HOST]: { gq1: 0, gq2: 1 } },
    });
    expect(resolvePhase(game, HOST)).toBe('waiting');
  });

  it('shows the summary when the game is finished', () => {
    expect(resolvePhase(makeGame({ status: 'finished' }), HOST)).toBe('finished');
  });
});

describe('state machine transitions', () => {
  it('moves lobby -> active when the host starts', async () => {
    await putGame(makeGame({ status: 'lobby' }));
    await startGame(db, GID, HOST);
    expect((await readGame()).status).toBe('active');
  });

  it('refuses to start a game for a non-host', async () => {
    await putGame(makeGame({ status: 'lobby' }));
    await expect(startGame(db, GID, P2)).rejects.toThrow(/host/i);
    expect((await readGame()).status).toBe('lobby');
  });

  it('refuses to start a game that is already active', async () => {
    await putGame(makeGame({ status: 'active' }));
    await expect(startGame(db, GID, HOST)).rejects.toThrow(/status active/);
  });

  it('advances to the next question without finishing', async () => {
    await putGame(
      makeGame({
        status: 'active',
        answers: { [HOST]: { gq1: 0 }, [P2]: { gq1: 0 }, [P3]: { gq1: 1 } },
        predictions: { [HOST]: { gq1: 0 }, [P2]: { gq1: 1 }, [P3]: { gq1: 0 } },
      }),
    );

    await advanceQuestion(db, GID, 'gq1', HOST);

    const game = await readGame();
    expect(game.status).toBe('active');
    expect(game.currentQuestionIndex).toBe(1);
    expect(game.scores).toEqual({ [HOST]: 1, [P3]: 1 });
  });

  it('finishes the game after the last question', async () => {
    await putGame(
      makeGame({
        status: 'active',
        currentQuestionIndex: 1,
        answers: { [HOST]: { gq2: 1 }, [P2]: { gq2: 1 }, [P3]: { gq2: 0 } },
        predictions: { [HOST]: { gq2: 1 } },
      }),
    );

    await advanceQuestion(db, GID, 'gq2', HOST);

    const game = await readGame();
    expect(game.status).toBe('finished');
    expect(game.currentQuestionIndex).toBe(1);
    expect(game.scores).toEqual({ [HOST]: 1 });
  });

  it('refuses to advance a game for a non-host', async () => {
    await putGame(makeGame({ status: 'active' }));
    await expect(advanceQuestion(db, GID, 'gq1', P2)).rejects.toThrow(/host/i);
  });

  it('refuses to advance a finished game', async () => {
    await putGame(makeGame({ status: 'finished' }));
    await expect(advanceQuestion(db, GID, 'gq1', HOST)).rejects.toThrow(/status finished/);
  });

  it('does not score the same question twice when advance fires twice', async () => {
    await putGame(
      makeGame({
        status: 'active',
        answers: { [HOST]: { gq1: 0 }, [P2]: { gq1: 0 }, [P3]: { gq1: 1 } },
        predictions: { [HOST]: { gq1: 0 } },
      }),
    );

    await advanceQuestion(db, GID, 'gq1', HOST);
    const afterFirst = (await readGame()).scores;

    // Host retries -- a double click, or a retry after a dropped response.
    await advanceQuestion(db, GID, 'gq1', HOST);

    expect((await readGame()).scores).toEqual(afterFirst);
  });

  it('does not double-score when two advances race', async () => {
    await putGame(
      makeGame({
        status: 'active',
        answers: { [HOST]: { gq1: 0 }, [P2]: { gq1: 0 }, [P3]: { gq1: 1 } },
        predictions: { [HOST]: { gq1: 0 } },
      }),
    );

    await Promise.allSettled([
      advanceQuestion(db, GID, 'gq1', HOST),
      advanceQuestion(db, GID, 'gq1', HOST),
    ]);

    expect((await readGame()).scores).toEqual({ [HOST]: 1 });
  });

  it('runs a full game lobby -> active -> finished with joint winners', async () => {
    await putGame(
      makeGame({
        status: 'lobby',
        // gq1 majority is 0; HOST and P2 predict 0, P3 predicts 1.
        // gq2 majority is 1; HOST predicts 0, P2 and P3 predict 1.
        answers: {
          [HOST]: { gq1: 0, gq2: 1 },
          [P2]: { gq1: 0, gq2: 1 },
          [P3]: { gq1: 1, gq2: 0 },
        },
        predictions: {
          [HOST]: { gq1: 0, gq2: 0 },
          [P2]: { gq1: 0, gq2: 1 },
          [P3]: { gq1: 1, gq2: 1 },
        },
      }),
    );

    await startGame(db, GID, HOST);
    expect((await readGame()).status).toBe('active');

    await advanceQuestion(db, GID, 'gq1', HOST);
    expect((await readGame()).currentQuestionIndex).toBe(1);

    await advanceQuestion(db, GID, 'gq2', HOST);

    const game = await readGame();
    expect(game.status).toBe('finished');
    // HOST: gq1 correct, gq2 wrong  = 1
    // P2:   gq1 correct, gq2 correct = 2
    // P3:   gq1 wrong,   gq2 correct = 1
    expect(game.scores).toEqual({ [HOST]: 1, [P2]: 2, [P3]: 1 });

    const board = leaderboard(PLAYERS, {}, game.scores);
    expect(winners(board).map((r) => r.uid)).toEqual([P2]);
  });

  it('names joint winners when the top score is tied', async () => {
    await putGame(
      makeGame({
        status: 'active',
        currentQuestionIndex: 1,
        answers: { [HOST]: { gq2: 0 }, [P2]: { gq2: 0 }, [P3]: { gq2: 1 } },
        predictions: { [HOST]: { gq2: 0 }, [P2]: { gq2: 0 }, [P3]: { gq2: 1 } },
        scores: { [HOST]: 0, [P2]: 0, [P3]: 1 },
      }),
    );

    await advanceQuestion(db, GID, 'gq2', HOST);

    const game = await readGame();
    expect(game.status).toBe('finished');
    expect(game.scores).toEqual({ [HOST]: 1, [P2]: 1, [P3]: 1 });

    const board = leaderboard(PLAYERS, {}, game.scores);
    expect(winners(board)).toHaveLength(3);
  });
});
