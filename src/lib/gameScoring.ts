import type { Game } from '../types';

/**
 * Game mode scoring.
 *
 * Extracted from the `nextQuestion` handler in GameResults.tsx so the rules in
 * CLAUDE.md can be tested directly:
 *
 *   correct majority prediction = 1 point
 *   wrong                       = 0
 *   50/50 split                 = 0 for everyone, "Perfectly Divided"
 *   skipped                     = 0
 *
 * Winner is the most accurate predictor, the "Best Mind Reader". Joint winners
 * are returned when tied.
 */
export type OptionIndex = 0 | 1;

/** uid -> questionId -> chosen option. */
export type PerPlayerChoices = Record<string, Record<string, number>>;

/** Votes for option 0 and option 1 on one question. Non-answers are not counted. */
export function tallyAnswers(
  players: string[],
  answers: PerPlayerChoices,
  questionId: string,
): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const uid of players) {
    const choice = answers?.[uid]?.[questionId];
    if (choice === 0 || choice === 1) counts[choice]++;
  }
  return counts;
}

/** The majority option, or null when the split is exactly even (or empty). */
export function majorityOf(counts: [number, number]): OptionIndex | null {
  if (counts[0] > counts[1]) return 0;
  if (counts[1] > counts[0]) return 1;
  return null;
}

/** True when the question drew votes and split them exactly evenly. */
export function isPerfectlyDivided(counts: [number, number]): boolean {
  return counts[0] + counts[1] > 0 && counts[0] === counts[1];
}

/**
 * Award one point to each player who predicted the majority.
 *
 * Returns a new scores map; the input is not modified. A 50/50 split scores
 * nobody, and a player who skipped either the answer or the prediction scores
 * nothing.
 */
export function scoreQuestion(args: {
  players: string[];
  answers: PerPlayerChoices;
  predictions: PerPlayerChoices;
  questionId: string;
  scores: Record<string, number>;
}): Record<string, number> {
  const { players, answers, predictions, questionId, scores } = args;
  const majority = majorityOf(tallyAnswers(players, answers, questionId));
  const next = { ...scores };
  if (majority === null) return next;

  for (const uid of players) {
    if (predictions?.[uid]?.[questionId] === majority) {
      next[uid] = (next[uid] ?? 0) + 1;
    }
  }
  return next;
}

export type LeaderboardRow = { uid: string; username: string; score: number };

/** Players ranked by score, highest first. */
export function leaderboard(
  players: string[],
  usernames: Record<string, string>,
  scores: Record<string, number>,
): LeaderboardRow[] {
  return players
    .map((uid) => ({ uid, username: usernames[uid] ?? uid, score: scores[uid] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The Best Mind Reader. Returns every player tied at the top, so joint winners
 * are shown rather than an arbitrary single one.
 */
export function winners(board: LeaderboardRow[]): LeaderboardRow[] {
  if (board.length === 0) return [];
  const top = Math.max(...board.map((r) => r.score));
  return board.filter((r) => r.score === top);
}

/** Question ids in this game that ended in an exact split. */
export function perfectlyDividedQuestions(game: Pick<Game, 'players' | 'answers' | 'questions'>) {
  return game.questions.filter((qId) =>
    isPerfectlyDivided(tallyAnswers(game.players, game.answers ?? {}, qId)),
  );
}
