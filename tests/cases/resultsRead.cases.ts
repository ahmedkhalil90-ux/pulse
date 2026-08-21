import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * results/{questionId} read access.
 *
 * The document holds the raw demographic map. Requiring authentication is a
 * first step only: it stops anonymous scraping, but any logged-in user still
 * reads the whole map, so the minimum-10 threshold and the 3-credit unlock
 * remain client-side. Rules cannot enforce a threshold on a map read -- see
 * the report for what a real fix needs.
 */
const READER = { uid: 'reader1', email: 'reader1@pulse.app' };
const QID = 'qread1';

const seedResults = (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'results', QID), {
    counts: { '0': 7, '1': 3 },
    demographics: {
      ageRange: { '25-34': { '0': 4, '1': 1 } },
      gender: { Male: { '0': 4, '1': 1 } },
      country: { UAE: { '0': 4, '1': 1 } },
    },
  });

export const resultsReadCases: Case[] = [
  {
    name: 'an authenticated user can read results',
    expect: 'allow',
    as: READER,
    seed: seedResults,
    run: (db) => getDoc(doc(db, 'results', QID)),
  },
  {
    name: 'an unauthenticated caller cannot read results',
    expect: 'deny',
    killedBy: 'M19',
    as: 'unauthenticated',
    seed: seedResults,
    run: (db) => getDoc(doc(db, 'results', QID)),
  },
];
