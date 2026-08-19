import { doc, increment, setDoc, updateDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import {
  DEMOS,
  PLAIN,
  QID,
  VOTER,
  VOTER2,
  seedAnswer,
  seedResults,
  seedUser,
} from '../helpers/fixtures';

const resultsRef = (db: any) => doc(db, 'results', QID);

/** A results doc mid-life: 10 votes, all from '25-34' / Male / UAE voters. */
const TEN_VOTES = {
  counts: { '0': 5, '1': 5 },
  demographics: {
    ageRange: { '25-34': { '0': 3, '1': 2 } },
    gender: { Male: { '0': 3, '1': 2 } },
    country: { UAE: { '0': 3, '1': 2 } },
  },
};

/** Same, but with no demographic buckets -- used by voters with no profile demographics. */
const TEN_VOTES_PLAIN = { counts: { '0': 5, '1': 5 }, demographics: {} };

export const resultsCases: Case[] = [
  {
    name: 'first vote creates the results doc holding exactly one vote',
    expect: 'allow',
    as: VOTER,
    seed: async (ctx) => {
      await seedUser(ctx, VOTER.uid, { demographics: DEMOS });
      await seedAnswer(ctx, VOTER.uid, QID, 0);
    },
    run: (db) =>
      setDoc(resultsRef(db), {
        counts: { '0': 1, '1': 0 },
        demographics: {
          ageRange: { '25-34': { '0': 1, '1': 0 } },
          gender: { Male: { '0': 1, '1': 0 } },
          country: { UAE: { '0': 1, '1': 0 } },
        },
      }),
  },
  {
    name: 'vote with no matching user_answers record is rejected',
    expect: 'deny',
    killedBy: 'M1',
    as: VOTER,
    seed: async (ctx) => {
      await seedUser(ctx, VOTER.uid, { demographics: DEMOS });
      // Deliberately no answer record.
    },
    run: (db) =>
      setDoc(resultsRef(db), {
        counts: { '0': 1, '1': 0 },
        demographics: {
          ageRange: { '25-34': { '0': 1, '1': 0 } },
          gender: { Male: { '0': 1, '1': 0 } },
          country: { UAE: { '0': 1, '1': 0 } },
        },
      }),
  },
  {
    name: 'incrementing the option the caller did NOT record is rejected',
    expect: 'deny',
    killedBy: 'M2',
    as: PLAIN,
    seed: async (ctx) => {
      // No demographics, so the demographic clauses are satisfied by an
      // untouched map and the caller-index equality is the only thing left
      // standing between this write and the results doc.
      await seedUser(ctx, PLAIN.uid);
      await seedAnswer(ctx, PLAIN.uid, QID, 0);
      await seedResults(ctx, QID, TEN_VOTES_PLAIN);
    },
    run: (db) => updateDoc(resultsRef(db), { 'counts.1': increment(1) }),
  },
  {
    name: 'decrementing a count is rejected',
    expect: 'deny',
    killedBy: 'M3c',
    note:
      'Killed only by removing BOTH the vote-total equality and the >= guards; ' +
      'either one alone still rejects this write. See M3/M3b probes.',
    as: PLAIN,
    seed: async (ctx) => {
      await seedUser(ctx, PLAIN.uid);
      await seedAnswer(ctx, PLAIN.uid, QID, 0);
      await seedResults(ctx, QID, TEN_VOTES_PLAIN);
    },
    run: (db) =>
      updateDoc(resultsRef(db), { 'counts.0': increment(1), 'counts.1': increment(-1) }),
  },
  {
    name: "incrementing another user's demographic bucket is rejected",
    expect: 'deny',
    killedBy: 'M4',
    as: VOTER,
    seed: async (ctx) => {
      await seedUser(ctx, VOTER.uid, { demographics: DEMOS });
      await seedAnswer(ctx, VOTER.uid, QID, 0);
      await seedResults(ctx, QID, {
        counts: { '0': 5, '1': 5 },
        demographics: {
          ageRange: { '25-34': { '0': 3, '1': 2 }, '35-44': { '0': 1, '1': 1 } },
          gender: { Male: { '0': 3, '1': 2 } },
          country: { UAE: { '0': 3, '1': 2 } },
        },
      });
    },
    // Counts and the caller's own gender/country buckets move correctly; only
    // the age bucket is wrong -- it credits the 35-44 group the caller is not in.
    run: (db) =>
      updateDoc(resultsRef(db), {
        'counts.0': increment(1),
        'demographics.ageRange.35-44.0': increment(1),
        'demographics.gender.Male.0': increment(1),
        'demographics.country.UAE.0': increment(1),
      }),
  },
  {
    name: 'adding a field beyond counts and demographics is rejected',
    expect: 'deny',
    killedBy: 'M5',
    as: VOTER,
    seed: async (ctx) => {
      await seedUser(ctx, VOTER.uid, { demographics: DEMOS });
      await seedAnswer(ctx, VOTER.uid, QID, 0);
    },
    run: (db) =>
      setDoc(resultsRef(db), {
        counts: { '0': 1, '1': 0 },
        demographics: {
          ageRange: { '25-34': { '0': 1, '1': 0 } },
          gender: { Male: { '0': 1, '1': 0 } },
          country: { UAE: { '0': 1, '1': 0 } },
        },
        // The whole point of the allowlist: no per-voter trail may ride along.
        lastVoterUid: VOTER.uid,
      }),
  },
  {
    name: 'a second voter incrementing by exactly one is allowed',
    expect: 'allow',
    as: VOTER2,
    seed: async (ctx) => {
      await seedUser(ctx, VOTER2.uid, {
        demographics: { ageRange: '25-34', gender: 'Female', country: 'UAE' },
      });
      await seedAnswer(ctx, VOTER2.uid, QID, 1);
      await seedResults(ctx, QID, TEN_VOTES);
    },
    run: (db) =>
      updateDoc(resultsRef(db), {
        'counts.1': increment(1),
        'demographics.ageRange.25-34.1': increment(1),
        // New bucket: the client creates only the incremented key.
        'demographics.gender.Female.1': increment(1),
        'demographics.country.UAE.1': increment(1),
      }),
  },
];
