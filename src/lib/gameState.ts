import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { Game } from '../types';
import { scoreQuestion } from './gameScoring';

/**
 * Game mode state machine.
 *
 * The stored status is coarse -- lobby | active | finished -- and the phase a
 * player actually sees is derived from their own progress within `active`.
 * `resolvePhase` mirrors the routing in GameView.tsx so the transitions can be
 * tested without rendering.
 */
export type GamePhase =
  | 'lobby'
  | 'submitting'
  | 'playing'
  | 'results'
  | 'waiting'
  | 'finished';

/** Which screen a given player is on. */
export function resolvePhase(game: Game, uid: string): GamePhase {
  if (game.status === 'lobby') return 'lobby';
  if (game.status === 'finished') return 'finished';

  const submitted = game.playerQuestions?.[uid]?.length ?? 0;
  if (submitted !== game.questionsPerPlayer) return 'submitting';

  if (game.type === 'live') {
    const questionId = game.questions[game.currentQuestionIndex];
    const allFinished = game.players.every(
      (p) =>
        game.answers?.[p]?.[questionId] !== undefined &&
        game.predictions?.[p]?.[questionId] !== undefined,
    );
    return allFinished ? 'results' : 'playing';
  }

  const next = game.questions.find(
    (qId) =>
      game.answers?.[uid]?.[qId] === undefined ||
      game.predictions?.[uid]?.[qId] === undefined,
  );
  return next ? 'playing' : 'waiting';
}

/** Settings the host fixes at kickoff. */
export type StartSettings = {
  deadline?: string | null;
  questionsPerPlayer?: number;
};

/** lobby -> active. Only the host may start, and only from the lobby. */
export async function startGame(
  db: Firestore,
  gameId: string,
  byUid: string,
  settings: StartSettings = {},
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', gameId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`No such game: ${gameId}`);

    const game = snap.data() as Game;
    if (game.hostUid !== byUid) throw new Error('Only the host can start the game');
    if (game.status !== 'lobby') throw new Error(`Cannot start a game in status ${game.status}`);

    tx.update(ref, {
      status: 'active',
      ...(settings.deadline !== undefined ? { deadline: settings.deadline } : {}),
      ...(settings.questionsPerPlayer !== undefined
        ? { questionsPerPlayer: settings.questionsPerPlayer }
        : {}),
      lastUpdated: new Date().toISOString(),
    });
  });
}

/**
 * Score the current question and move on, finishing the game after the last
 * one.
 *
 * Idempotent per question: the ids already scored are recorded on the game, so
 * a retried or double-fired advance cannot award the same question twice.
 */
export async function advanceQuestion(
  db: Firestore,
  gameId: string,
  questionId: string,
  byUid: string,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', gameId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`No such game: ${gameId}`);

    const game = snap.data() as Game & { scoredQuestions?: string[] };
    if (game.hostUid !== byUid) throw new Error('Only the host can advance the game');
    if (game.status !== 'active') {
      throw new Error(`Cannot advance a game in status ${game.status}`);
    }

    const scored = game.scoredQuestions ?? [];
    const alreadyScored = scored.includes(questionId);

    const scores = alreadyScored
      ? (game.scores ?? {})
      : scoreQuestion({
          players: game.players,
          answers: game.answers ?? {},
          predictions: game.predictions ?? {},
          questionId,
          scores: game.scores ?? {},
        });

    const isLast = game.currentQuestionIndex === game.questions.length - 1;

    tx.update(ref, {
      status: isLast ? 'finished' : 'active',
      currentQuestionIndex: isLast
        ? game.currentQuestionIndex
        : game.currentQuestionIndex + 1,
      scores,
      scoredQuestions: alreadyScored ? scored : [...scored, questionId],
      lastUpdated: new Date().toISOString(),
    });
  });
}
