import type { Case } from './env';
import { adminIdentityCases } from '../cases/adminIdentity.cases';
import { gameAuthorCases } from '../cases/gameAuthor.cases';
import { gamesCases } from '../cases/games.cases';
import { groupMembersCases } from '../cases/groupMembers.cases';
import { groupsCases } from '../cases/groups.cases';
import { migrationCases } from '../cases/migration.cases';
import { moderationCases } from '../cases/moderation.cases';
import { questionsCases } from '../cases/questions.cases';
import { resultsCases } from '../cases/results.cases';
import { resultsReadCases } from '../cases/resultsRead.cases';
import { skipsAndUnlocksCases } from '../cases/skipsAndUnlocks.cases';
import { userAnswersCases } from '../cases/userAnswers.cases';
import { usersRoleCases } from '../cases/usersRole.cases';
import { usersLookupCases } from '../cases/usersLookup.cases';
import { opsCases } from '../cases/ops.cases';
import { referralsCases } from '../cases/referrals.cases';
import { activityCases } from '../cases/activity.cases';
import { invitesCases } from '../cases/invites.cases';
import { knockoutCases } from '../cases/knockout.cases';
import { creditsRulesCases } from '../cases/creditsRules.cases';

/**
 * The single source of truth for every rules case. Both the real suite and the
 * mutation harness read this, so a case cannot be exercised by one and quietly
 * missing from the other.
 */
export const SUITES: Array<[string, Case[]]> = [
  ['results/{questionId}', resultsCases],
  ['results/{questionId} reads', resultsReadCases],
  ['questions/{questionId}', questionsCases],
  ['moderation queue', moderationCases],
  ['isMigrating() via users/{oldUid}', migrationCases],
  ['user_answers/{answerId}', userAnswersCases],
  ['ops/{docId}', opsCases],
  ['referrals/{refereeUid}', referralsCases],
  ['activity/{docId}', activityCases],
  ['invites, member numbers, waitlist', invitesCases],
  ['knockout brackets', knockoutCases],
  ['credits move only with their action', creditsRulesCases],
  ['admin identity', adminIdentityCases],
  ['skips and unlocks', skipsAndUnlocksCases],
  ['games/{gameId} reads', gamesCases],
  ['game question authorship', gameAuthorCases],
  ['groups/{groupId} updates', groupsCases],
  ['groups member privacy', groupMembersCases],
  ['users/{userId} role escalation', usersRoleCases],
  ['users listability and lookups', usersLookupCases],
];

export const ALL_CASES: Case[] = SUITES.flatMap(([, cases]) => cases);

export function caseByName(name: string): Case {
  const found = ALL_CASES.find((c) => c.name === name);
  if (!found) throw new Error(`No case named "${name}"`);
  return found;
}
