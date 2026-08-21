import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * skipped_questions and users/{uid}/unlockedDemographics.
 *
 * The last two rule surfaces with no coverage at all.
 *
 * skipped_questions records which questions a user chose not to answer, keyed
 * by their UID -- the same identity-to-behaviour link user_answers carries, so
 * it deserves the same scrutiny.
 *
 * unlockedDemographics gates a paid feature: CLAUDE.md says once unlocked for
 * a question, never charge again. That only holds if the record cannot be
 * removed.
 */
const OWNER = { uid: 'skip-owner', email: 'skipowner@pulse.app' };
const OTHER = { uid: 'skip-other', email: 'skipother@pulse.app' };
const ADMIN = { uid: '7zNbw98m9jZYy8uTan7dqwolBud2', email: 'ak@pulse.app' };
const QID = 'skip-q';
/** Deterministic, exactly as App.tsx builds it. */
const SKIP_ID = `${OWNER.uid}_${QID}`;

async function seedSkip(ctx: RulesTestContext) {
  await setDoc(doc(ctx.firestore(), 'skipped_questions', SKIP_ID), {
    userId: OWNER.uid,
    questionId: QID,
    skippedAt: '2026-08-20T00:00:00.000Z',
  });
}

async function seedOtherSkip(ctx: RulesTestContext) {
  await setDoc(doc(ctx.firestore(), 'skipped_questions', `${OTHER.uid}_${QID}`), {
    userId: OTHER.uid,
    questionId: QID,
    skippedAt: '2026-08-20T00:00:00.000Z',
  });
}

async function seedUnlock(ctx: RulesTestContext) {
  await setDoc(doc(ctx.firestore(), 'users', OWNER.uid, 'unlockedDemographics', QID), {
    unlockedAt: '2026-08-20T00:00:00.000Z',
  });
}

const skipRef = (db: any, id = SKIP_ID) => doc(db, 'skipped_questions', id);
const unlockRef = (db: any, uid = OWNER.uid) =>
  doc(db, 'users', uid, 'unlockedDemographics', QID);

export const skipsAndUnlocksCases: Case[] = [
  // --- skipped_questions ----------------------------------------------------
  {
    name: 'a user can read their own skip record',
    expect: 'allow',
    as: OWNER,
    seed: seedSkip,
    run: (db) => getDoc(skipRef(db)),
  },
  {
    name: "a user cannot read another user's skip record",
    expect: 'deny',
    killedBy: 'M70',
    as: OTHER,
    seed: seedSkip,
    run: (db) => getDoc(skipRef(db)),
  },
  {
    name: 'a user may query their own skips',
    expect: 'allow',
    as: OWNER,
    seed: seedSkip,
    run: (db) =>
      getDocs(
        query(collection(db, 'skipped_questions'), where('userId', '==', OWNER.uid)),
      ),
  },
  {
    name: 'a user cannot list every skip record',
    expect: 'deny',
    killedBy: 'M70',
    // An unfiltered scan would expose what everyone declined to answer.
    as: OTHER,
    seed: seedSkip,
    run: (db) => getDocs(collection(db, 'skipped_questions')),
  },
  {
    name: 'a user may record their own skip',
    expect: 'allow',
    as: OWNER,
    run: (db) =>
      setDoc(skipRef(db), {
        userId: OWNER.uid,
        questionId: QID,
        skippedAt: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'skipping the same question again still works',
    expect: 'allow',
    // The skip id is deterministic, so a repeat is a setDoc over an existing
    // document, which Firestore evaluates as an update. Any retry hits this.
    as: OWNER,
    seed: seedSkip,
    run: (db) =>
      setDoc(skipRef(db), {
        userId: OWNER.uid,
        questionId: QID,
        skippedAt: '2026-08-21T00:00:00.000Z',
      }),
  },
  {
    name: 'a user cannot record a skip for someone else',
    expect: 'deny',
    killedBy: 'M71',
    as: OTHER,
    run: (db) =>
      setDoc(skipRef(db), {
        userId: OWNER.uid,
        questionId: QID,
        skippedAt: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'a skip record cannot carry extra fields',
    expect: 'deny',
    killedBy: 'M72',
    as: OWNER,
    run: (db) =>
      setDoc(skipRef(db), {
        userId: OWNER.uid,
        questionId: QID,
        skippedAt: '2026-08-20T00:00:00.000Z',
        answerIndex: 1,
      }),
  },
  {
    name: "a user cannot rewrite another user's skip",
    expect: 'deny',
    killedBy: 'M71',
    as: OWNER,
    seed: seedOtherSkip,
    run: (db) =>
      setDoc(skipRef(db, `${OTHER.uid}_${QID}`), {
        userId: OTHER.uid,
        questionId: QID,
        skippedAt: '2026-08-21T00:00:00.000Z',
      }),
  },
  {
    name: 'a user may delete their own skip',
    expect: 'allow',
    as: OWNER,
    seed: seedSkip,
    run: (db) => deleteDoc(skipRef(db)),
  },

  // --- unlockedDemographics -------------------------------------------------
  {
    name: 'a user can read their own unlock record',
    expect: 'allow',
    as: OWNER,
    seed: seedUnlock,
    run: (db) => getDoc(unlockRef(db)),
  },
  {
    name: "a user cannot read another user's unlock record",
    expect: 'deny',
    killedBy: 'M73',
    as: OTHER,
    seed: seedUnlock,
    run: (db) => getDoc(unlockRef(db)),
  },
  {
    name: 'a user may record their own unlock',
    expect: 'allow',
    as: OWNER,
    run: (db) => setDoc(unlockRef(db), { unlockedAt: '2026-08-20T00:00:00.000Z' }),
  },
  {
    name: 'a user cannot delete an unlock they paid for',
    expect: 'deny',
    killedBy: 'M74',
    // CLAUDE.md: once unlocked for a question, never charge again. Deleting
    // the record is how a user would be charged twice.
    as: OWNER,
    seed: seedUnlock,
    run: (db) => deleteDoc(unlockRef(db)),
  },
  {
    name: 'a user cannot rewrite an unlock record',
    expect: 'deny',
    killedBy: 'M74',
    as: OWNER,
    seed: seedUnlock,
    run: (db) => updateDoc(unlockRef(db), { unlockedAt: '1999-01-01T00:00:00.000Z' }),
  },
  {
    name: 'an unlock record cannot carry extra fields',
    expect: 'deny',
    killedBy: 'M75',
    as: OWNER,
    run: (db) =>
      setDoc(unlockRef(db), { unlockedAt: '2026-08-20T00:00:00.000Z', paid: false }),
  },
  {
    name: "a user cannot create an unlock under another user's profile",
    expect: 'deny',
    killedBy: 'M73',
    as: OTHER,
    run: (db) => setDoc(unlockRef(db), { unlockedAt: '2026-08-20T00:00:00.000Z' }),
  },
];
