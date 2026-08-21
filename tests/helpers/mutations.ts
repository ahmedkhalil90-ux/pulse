/**
 * Rules mutations for verifying that each negative test is load-bearing.
 *
 * Each mutation loosens exactly one guard in firestore.rules. The file itself
 * is never written -- `applyMutation` returns a modified STRING that is loaded
 * into a throwaway emulator project.
 */
export type Mutation = {
  id: string;
  label: string;
  edits: Array<{ find: string; replace: string }>;
  /**
   * Diagnostic only. A probe is not expected to kill anything; its purpose is
   * to show whether a guard is individually load-bearing. Survival is reported
   * as a finding, not a test failure.
   */
  probe?: { cases: string[]; question: string };
};

const VOTE_TOTAL_UPDATE =
  '        && voteTotal(request.resource.data) == voteTotal(resource.data) + 1';

const MONOTONIC_GUARDS =
  "        && request.resource.data.counts.get('0', 0) >= resource.data.counts.get('0', 0)\n" +
  "        && request.resource.data.counts.get('1', 0) >= resource.data.counts.get('1', 0)";

export const MUTATIONS: Mutation[] = [
  {
    id: 'M1',
    label: "results: rules no longer consult the caller's answer record",
    edits: [
      { find: 'return exists(answerPath(questionId));', replace: 'return true;' },
      {
        find: 'return string(get(answerPath(questionId)).data.answerIndex);',
        replace: "return '0';",
      },
    ],
  },
  {
    id: 'M2',
    label: 'results: the incremented option need not match the recorded answer',
    edits: [
      {
        find:
          '        && request.resource.data.counts.get(callerAnswerIndex(questionId), 0)\n' +
          '             == resource.data.counts.get(callerAnswerIndex(questionId), 0) + 1',
        replace: '        && true',
      },
    ],
  },
  {
    id: 'M3',
    label: 'results: vote total need not increase by exactly one',
    edits: [{ find: VOTE_TOTAL_UPDATE, replace: '        && true' }],
    probe: {
      cases: ['decrementing a count is rejected'],
      question: 'Is the vote-total equality individually load-bearing against a plain decrement?',
    },
  },
  {
    id: 'M3b',
    label: 'results: counts may decrease (>= guards removed)',
    edits: [{ find: MONOTONIC_GUARDS, replace: '        && true' }],
    probe: {
      cases: ['decrementing a count is rejected'],
      question: 'Are the >= monotonicity guards individually load-bearing?',
    },
  },
  {
    id: 'M3c',
    label: 'results: both the vote-total equality AND the >= guards removed',
    edits: [
      { find: VOTE_TOTAL_UPDATE, replace: '        && true' },
      { find: MONOTONIC_GUARDS, replace: '        && true' },
    ],
  },
  {
    id: 'M4',
    label: 'results: demographic buckets are unchecked on update',
    edits: [
      {
        find:
          "        && demoUpdateOk(request.resource.data.get('demographics', {}),\n" +
          "                        resource.data.get('demographics', {}),\n" +
          '                        callerAnswerIndex(questionId));',
        replace: '        && true;',
      },
    ],
  },
  {
    id: 'M5',
    label: 'results: create field allowlist removed',
    edits: [
      {
        find: "        && request.resource.data.keys().hasOnly(['counts', 'demographics'])",
        replace: '        && true',
      },
    ],
  },
  {
    id: 'M6',
    label: 'questions: authors may flag their own question',
    edits: [
      {
        find: '                        && resource.data.authorUid != request.auth.uid',
        replace: '                        && true',
      },
    ],
  },
  {
    id: 'M7',
    label: 'questions: the flags == old + 1 equality removed',
    edits: [
      {
        find: "        && request.resource.data.flags == resource.data.get('flags', 0) + 1",
        replace: '        && true',
      },
    ],
  },
  {
    id: 'M8',
    label: 'questions: status may be set freely on a flag write',
    edits: [
      {
        find:
          "        && (!changed.hasAny(['status'])\n" +
          "            || (request.resource.data.status == 'flagged' && request.resource.data.flags >= 5));",
        replace: '        && true;',
      },
    ],
  },
  {
    id: 'M9',
    label: 'questions: boost author check removed',
    edits: [
      {
        find:
          '                        && resource.data.authorUid == request.auth.uid\n' +
          "                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['boostCount'])",
        replace:
          '                        && true\n' +
          "                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['boostCount'])",
      },
    ],
  },
  {
    id: 'M10',
    label: 'questions: boost amount need not be exactly +100',
    edits: [
      {
        find:
          "                        && request.resource.data.boostCount == resource.data.get('boostCount', 0) + 100)",
        replace: '                        && true)',
      },
    ],
  },
  {
    id: 'M11',
    label: 'questions: migration write may touch fields beyond authorUid',
    edits: [
      {
        find:
          "                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['authorUid'])",
        replace: '                        && true',
      },
    ],
  },
  {
    id: 'M12',
    label: 'isMigrating: token-email / username proof removed',
    edits: [
      {
        find:
          '             request.auth.token.email.lower() ==\n' +
          "               get(/databases/$(database)/documents/users/$(oldUid)).data.username.lower() + '@pulse.app';",
        replace: '             true;',
      },
    ],
  },
  {
    id: 'M13',
    label: 'user_answers: ownership check removed from the update clause',
    edits: [
      {
        find:
          '                        && resource.data.userId == request.auth.uid\n' +
          '                        && request.resource.data.userId == request.auth.uid',
        replace: '                        && true\n                        && true',
      },
    ],
  },
  {
    id: 'M15',
    label: 'games: any authenticated user may read any game',
    edits: [
      {
        find:
          '      allow read: if isAuthenticated() && (\n' +
          '                    request.auth.uid in resource.data.players ||\n' +
          "                    resource.data.status == 'lobby'\n" +
          '                  );',
        replace: '      allow read: if isAuthenticated();',
      },
    ],
  },
  {
    id: 'M16',
    label: 'games: the read auth gate is removed',
    edits: [
      {
        find:
          '      allow read: if isAuthenticated() && (\n' +
          '                    request.auth.uid in resource.data.players ||\n' +
          "                    resource.data.status == 'lobby'\n" +
          '                  );',
        replace: '      allow read: if true;',
      },
    ],
  },
  {
    id: 'M18',
    label: 'groups: update reverts to any authenticated user',
    edits: [
      {
        find:
          '                        && (\n' +
          '                          // Join: your membership document now exists, so the\n' +
          '                          // count goes up by one. The invite-code proof is\n' +
          "                          // enforced on that document's create.\n" +
          '                          (request.resource.data.memberCount == resource.data.memberCount + 1\n' +
          '                           && isGroupMember(groupId))\n' +
          '                          ||\n' +
          '                          // Leave: your membership document is gone, so the\n' +
          '                          // count goes down by one.\n' +
          '                          (request.resource.data.memberCount == resource.data.memberCount - 1\n' +
          '                           && !isGroupMember(groupId))\n' +
          '                        ));',
        replace: '                        && true);',
      },
      {
        find:
          "                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberCount'])\n",
        replace: '                        && true\n',
      },
    ],
  },
  {
    id: 'M38',
    label: 'groups: a membership document is readable by anyone',
    edits: [
      {
        find:
          '        allow get: if isAdmin()\n' +
          '                   || (isAuthenticated() && resource.data.uid == request.auth.uid);',
        replace: '        allow get: if isAuthenticated();',
      },
    ],
  },
  {
    id: 'M39',
    label: 'groups: the roster becomes listable',
    edits: [
      {
        find: '        allow list: if isAuthenticated() && resource.data.uid == request.auth.uid;',
        replace: '        allow list: if isAuthenticated();',
      },
    ],
  },
    {
    id: 'M41',
    label: 'groups: a membership may be created for any UID',
    edits: [
      {
        find: '        allow create: if isOwner(memberUid)\n',
        replace: '        allow create: if isAuthenticated()\n',
      },
    ],
  },
  {
    id: 'M42',
    label: 'groups: the membership field allowlist is removed',
    edits: [
      {
        find: "                      && request.resource.data.keys().hasOnly(['uid', 'joinedAt'])\n",
        replace: '                      && true\n',
      },
    ],
  },
  {
    id: 'M43',
    label: 'groups: memberCount need not track the membership documents',
    edits: [
      {
        find: '                          (request.resource.data.memberCount == resource.data.memberCount + 1\n                           && isGroupMember(groupId))\n                          ||\n                          // Leave: your membership document is gone, so the\n                          // count goes down by one.\n                          (request.resource.data.memberCount == resource.data.memberCount - 1\n                           && !isGroupMember(groupId))',
        replace: '                          true',
      },
    ],
  },
  {
    id: 'M44',
    label: 'groups: a count update may touch other fields',
    edits: [
      {
        find: "                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberCount'])\n",
        replace: '                        && true\n',
      },
    ],
  },
  {
    id: 'M45',
    label: 'groups: any member may delete any membership',
    edits: [
      {
        find: '        allow delete: if isOwner(memberUid)\n',
        replace: '        allow delete: if isAuthenticated()\n',
      },
    ],
  },
  {
    id: 'M46',
    label: 'groups: create no longer constrains memberCount or forbids members',
    edits: [
      {
        find: "                    request.resource.data.memberCount == 1 &&\n                    !request.resource.data.keys().hasAny(['members']);",
        replace: '                    true;',
      },
    ],
  },
  {
    id: 'M20',
    label: 'groups: joining no longer requires proof of the invite code',
    edits: [
      {
        find:
          '      return exists(/databases/$(database)/documents/groups/$(groupId)/joinRequests/$(request.auth.uid))\n' +
          '             && get(/databases/$(database)/documents/groups/$(groupId)/joinRequests/$(request.auth.uid)).data.code == inviteCode;',
        replace: '      return true;',
      },
    ],
  },
  {
    id: 'M24',
    label: 'groups: a proof is accepted on existence alone, without matching the current code',
    edits: [
      {
        find:
          '\n             && get(/databases/$(database)/documents/groups/$(groupId)/joinRequests/$(request.auth.uid)).data.code == inviteCode;',
        replace: ';',
      },
    ],
  },
  {
    id: 'M21',
    label: 'groups: the submitted code is no longer compared to the group',
    edits: [
      {
        find:
          '                      && request.resource.data.code ==\n' +
          '                           get(/databases/$(database)/documents/groups/$(groupId)).data.inviteCode;',
        replace: '                      && true;',
      },
    ],
  },
  {
    id: 'M22',
    label: 'groups: a proof may be created for any UID, not just the caller',
    edits: [
      {
        find: '                      && request.auth.uid == requesterUid\n',
        replace: '                      && true\n',
      },
    ],
  },
  {
    id: 'M23',
    label: 'groups: the proof field allowlist is removed',
    edits: [
      {
        find: "                      && request.resource.data.keys().hasOnly(['code'])\n",
        replace: '                      && true\n',
      },
    ],
  },
  {
    id: 'M25',
    label: 'users: the role guard is removed, allowing self-promotion to admin',
    edits: [
      {
        find:
          "                    && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['role'])\n" +
          '                        || isAdmin());',
        replace: '                    && true;',
      },
    ],
  },
  {
    id: 'M26',
    label: 'games: joining no longer requires the game to be in the lobby',
    edits: [
      {
        find: "        (resource.data.status == 'lobby' &&\n",
        replace: '        (true &&\n',
      },
    ],
  },
  {
    id: 'M27',
    label: 'games: the added player need not be the caller',
    edits: [
      {
        find: '         !(request.auth.uid in resource.data.players) &&\n',
        replace: '         true &&\n',
      },
    ],
  },
  {
    id: 'M28',
    label: 'games: the join field allowlist is removed',
    edits: [
      {
        find:
          "         request.resource.data.diff(resource.data).affectedKeys().hasOnly(['players', 'scores']) &&\n",
        replace: '         true &&\n',
      },
    ],
  },
  {
    id: 'M29',
    label: 'games: leaving may remove someone other than the caller',
    edits: [
      {
        find: '         !(request.auth.uid in request.resource.data.players)) ||\n',
        replace: '         true) ||\n',
      },
    ],
  },
  {
    id: 'M30',
    label: 'games: the host field allowlist is removed',
    edits: [
      {
        find:
          '         request.resource.data.diff(resource.data).affectedKeys().hasOnly(\n' +
          "           ['status', 'currentQuestionIndex', 'scores', 'scoredQuestions',\n" +
          "            'deadline', 'questionsPerPlayer', 'lastUpdated'])) ||",
        replace: '         true) ||',
      },
    ],
  },
  {
    id: 'M31',
    label: 'games: the player field allowlist is removed',
    edits: [
      {
        find:
          '         request.resource.data.diff(resource.data).affectedKeys().hasOnly(\n' +
          "           ['answers', 'predictions', 'playerQuestions', 'questions', 'lastUpdated']) &&\n",
        replace: '         true &&\n',
      },
    ],
  },
  {
    id: 'M32',
    label: "games: a player may write another player's map entries",
    edits: [
      {
        find:
          '      return newData.get(field, {}).diff(oldData.get(field, {}))\n' +
          '               .affectedKeys().hasOnly([request.auth.uid]);',
        replace: '      return true;',
      },
    ],
  },
  {
    id: 'M33',
    label: 'games: the question list need not be append-only',
    edits: [
      {
        find:
          "         request.resource.data.get('questions', []).hasAll(resource.data.get('questions', []))) ||",
        replace: '         true) ||',
      },
    ],
  },
  {
    id: 'M34',
    label: 'users: profile creation may carry a role field',
    edits: [
      {
        find: "                    && (!request.resource.data.keys().hasAny(['role']) || isAdmin());",
        replace: '                    && true;',
      },
    ],
  },
  {
    id: 'M35',
    label: 'users: a profile may be created for any UID',
    edits: [
      {
        find: '      allow create: if isOwner(userId)\n',
        replace: '      allow create: if isAuthenticated()\n',
      },
    ],
  },
  {
    id: 'M36',
    label: 'games: status may move in any direction, including back to lobby',
    edits: [
      {
        find:
          "      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['status'])\n" +
          "             || (resource.data.status == 'lobby' && request.resource.data.status == 'active')\n" +
          "             || (resource.data.status == 'active' && request.resource.data.status == 'finished');",
        replace: '      return true;',
      },
    ],
  },
  {
    id: 'M37',
    label: 'games: a joiner may rewrite scores beyond their own entry',
    edits: [
      {
        find: "         ownKeyOnly(resource.data, request.resource.data, 'scores') &&\n",
        replace: '         true &&\n',
      },
    ],
  },
  {
    id: 'M47',
    label: 'games: a player may change an answer or prediction already recorded',
    edits: [
      {
        find:
          '      return newData.get(field, {}).get(request.auth.uid, {})\n' +
          '               .diff(oldData.get(field, {}).get(request.auth.uid, {}))\n' +
          '               .changedKeys().size() == 0\n' +
          '             && newData.get(field, {}).get(request.auth.uid, {})\n' +
          '                  .diff(oldData.get(field, {}).get(request.auth.uid, {}))\n' +
          '                  .removedKeys().size() == 0;',
        replace: '      return true;',
      },
    ],
  },
  {
    id: 'M19',
    label: 'results: the read auth gate is removed',
    edits: [
      {
        find:
          '      // it is. See AUTOMATION_SETUP.md finding 2.\n' +
          '      allow read: if isAuthenticated();',
        replace:
          '      // it is. See AUTOMATION_SETUP.md finding 2.\n' +
          '      allow read: if true;',
      },
    ],
  },
  {
    id: 'M14',
    label: 'user_answers: questionId is no longer immutable',
    edits: [
      {
        find:
          '                        && request.resource.data.questionId == resource.data.questionId);',
        replace: '                        && true);',
      },
    ],
  },
];

/**
 * Apply a mutation to the rules source.
 *
 * Every `find` must occur exactly once. A rules edit that changes the wording
 * of a guard therefore breaks this loudly, rather than silently turning a
 * mutation into a no-op and letting a vacuous test go on "passing".
 */
export function applyMutation(rules: string, m: Mutation): string {
  let out = rules;
  for (const { find, replace } of m.edits) {
    const hits = out.split(find).length - 1;
    if (hits !== 1) {
      throw new Error(
        `Mutation ${m.id}: expected exactly 1 occurrence of the target text in ` +
          `firestore.rules, found ${hits}. The rule was probably reworded; ` +
          `update the mutation.\n--- target ---\n${find}`,
      );
    }
    out = out.replace(find, replace);
  }
  return out;
}
