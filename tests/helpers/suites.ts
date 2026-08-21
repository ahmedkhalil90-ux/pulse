import type { Case } from './env';
import { adminIdentityCases } from '../cases/adminIdentity.cases';
import { migrationCases } from '../cases/migration.cases';
import { questionsCases } from '../cases/questions.cases';
import { resultsCases } from '../cases/results.cases';
import { userAnswersCases } from '../cases/userAnswers.cases';

/**
 * The single source of truth for every rules case. Both the real suite and the
 * mutation harness read this, so a case cannot be exercised by one and quietly
 * missing from the other.
 */
export const SUITES: Array<[string, Case[]]> = [
  ['results/{questionId}', resultsCases],
  ['questions/{questionId}', questionsCases],
  ['isMigrating() via users/{oldUid}', migrationCases],
  ['user_answers/{answerId}', userAnswersCases],
  ['admin identity', adminIdentityCases],
];

export const ALL_CASES: Case[] = SUITES.flatMap(([, cases]) => cases);

export function caseByName(name: string): Case {
  const found = ALL_CASES.find((c) => c.name === name);
  if (!found) throw new Error(`No case named "${name}"`);
  return found;
}
