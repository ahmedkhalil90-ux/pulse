import { collection, doc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * Admin review of questions held at `pending`.
 *
 * Moderation fails closed, so any moderator error stores a question as
 * `pending` and it never reaches the feed. The review path needs an admin to
 * be able to list those and move them to `live` or `rejected`, and needs
 * everyone else to be unable to.
 *
 * No rules change was required for this -- the questions update rule already
 * grants isAdmin() an unrestricted path. These cases exist so that stays true.
 */
// Admin under both rulesets: the UID satisfies the UID-only isAdmin() from
// security/admin-uid-only, the email satisfies the allow-list this chain still
// carries. So these cases hold before and after that branch is merged.
const ADMIN = { uid: '7zNbw98m9jZYy8uTan7dqwolBud2', email: 'ak@pulse.app' };
const AUTHOR = { uid: 'mod-author', email: 'modauthor@pulse.app' };
const STRANGER = { uid: 'mod-stranger', email: 'modstranger@pulse.app' };
const QID = 'mod-q';

const seedPending = (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'questions', QID), {
    text: 'Held for review?',
    options: ['Yes', 'No'],
    category: 'general',
    authorUid: AUTHOR.uid,
    isPublic: true,
    createdAt: '2026-08-20T00:00:00.000Z',
    status: 'pending',
    flags: 0,
    flags_unclear: 0,
    flags_inappropriate: 0,
    boostCount: 0,
  });

const qRef = (db: any) => doc(db, 'questions', QID);

const pendingQuery = (db: any) =>
  getDocs(
    query(
      collection(db, 'questions'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(50),
    ),
  );

export const moderationCases: Case[] = [
  {
    name: 'an admin can list questions held for review',
    expect: 'allow',
    as: ADMIN,
    seed: seedPending,
    run: pendingQuery,
  },
  {
    name: 'an admin can approve a held question',
    expect: 'allow',
    as: ADMIN,
    seed: seedPending,
    run: (db) => updateDoc(qRef(db), { status: 'live' }),
  },
  {
    name: 'an admin can reject a held question with a reason',
    expect: 'allow',
    as: ADMIN,
    seed: seedPending,
    run: (db) =>
      updateDoc(qRef(db), { status: 'rejected', rejectionReason: 'Rejected in review' }),
  },
  {
    name: 'the author cannot approve their own held question',
    expect: 'deny',
    // Covered by the questions update rule: a bare status write is not a flag
    // write, a boost, or a migration, and the author is not an admin.
    as: AUTHOR,
    seed: seedPending,
    run: (db) => updateDoc(qRef(db), { status: 'live' }),
  },
  {
    name: 'a stranger cannot approve a held question',
    expect: 'deny',
    as: STRANGER,
    seed: seedPending,
    run: (db) => updateDoc(qRef(db), { status: 'live' }),
  },
];
