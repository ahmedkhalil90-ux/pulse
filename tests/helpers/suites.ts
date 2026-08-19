import type { Case } from './env';
import { gamesCases } from '../cases/games.cases';
import { groupsCases } from '../cases/groups.cases';
import { migrationCases } from '../cases/migration.cases';
import { questionsCases } from '../cases/questions.cases';
import { resultsCases } from '../cases/results.cases';
import { resultsReadCases } from '../cases/resultsRead.cases';
import { userAnswersCases } from '../cases/userAnswers.cases';

/**
 * The single source of truth for every rules case. Both the real suite and the
 * mutation harness read this, so a case cannot be exercised by one and quietly
 * missing from the other.
 */
export const SUITES: Array<[string, Case[]]> = [
  ['results/{questionId}', resultsCases],
  ['results/{questionId} reads', resultsReadCases],
  ['questions/{questionId}', questionsCases],
  ['isMigrating() via users/{oldUid}', migrationCases],
  ['user_answers/{answerId}', userAnswersCases],
  ['games/{gameId} reads', gamesCases],
  ['groups/{groupId} updates', groupsCases],
];

export const ALL_CASES: Case[] = SUITES.flatMap(([, cases]) => cases);

export function caseByName(name: string): Case {
  const found = ALL_CASES.find((c) => c.name === name);
  if (!found) throw new Error(`No case named "${name}"`);
  return found;
}
