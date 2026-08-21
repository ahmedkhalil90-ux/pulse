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
    id: 'M60',
    label: 'users: the collection is listable again',
    edits: [
      {
        // Anchored on the users-block comment, not the adjacent create rule:
        // security/admin-uid-only replaces `allow create: if true;` with a
        // role-guarded version, which silently unmatched this target once the
        // two branches were merged.
        find:
          '      // go through the usernames and referralCodes mappings below.\n' +
          '      allow get: if isAuthenticated();\n' +
          '      allow list: if isAdmin();',
        replace:
          '      // go through the usernames and referralCodes mappings below.\n' +
          '      allow get: if isAuthenticated();\n' +
          '      allow list: if isAuthenticated();',
      },
    ],
  },
  {
    id: 'M61',
    label: 'usernames: the token-email proof is removed',
    edits: [
      {
        find:
          '                                && request.auth.token.email != null\n' +
          "                                && request.auth.token.email.lower() == usernameLower + '@pulse.app');",
        replace: '                                && true);',
      },
    ],
  },
  {
    id: 'M62',
    label: 'usernames: the mapping may point at any uid',
    edits: [
      {
        find: '                                && request.resource.data.uid == request.auth.uid\n',
        replace: '                                && true\n',
      },
    ],
  },
  {
    id: 'M63',
    label: 'usernames: the field allowlist is removed',
    edits: [
      {
        find: "                                && request.resource.data.keys().hasOnly(['uid'])\n",
        replace: '                                && true\n',
      },
    ],
  },
  {
    id: 'M64',
    label: 'usernames: the collection becomes listable',
    edits: [
      {
        find:
          '      // everyone, which is the problem it was introduced to solve.\n' +
          '      allow list: if isAdmin();',
        replace:
          '      // everyone, which is the problem it was introduced to solve.\n' +
          '      allow list: if isAuthenticated();',
      },
    ],
  },
  {
    id: 'M65',
    label: 'referralCodes: the code is no longer checked against the caller profile',
    edits: [
      {
        find:
          '                        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.referralCode == code);',
        replace: '                        && true);',
      },
    ],
  },
  {
    id: 'M66',
    label: 'referralCodes: the mapping may point at any uid',
    edits: [
      {
        find:
          '                        && request.resource.data.uid == request.auth.uid\n' +
          '                        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.referralCode == code);',
        replace:
          '                        && true\n' +
          '                        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.referralCode == code);',
      },
    ],
  },
  {
    id: 'M67',
    label: 'referralCodes: the collection becomes listable',
    edits: [
      {
        find: '      allow list: if isAdmin();\n      allow create: if isAdmin()',
        replace: '      allow list: if isAuthenticated();\n      allow create: if isAdmin()',
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
