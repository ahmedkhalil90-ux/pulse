import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';
import { PLAIN } from '../helpers/fixtures';

/** ops/*: written by scheduled jobs; only the question index is readable. */
async function seedOps(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'ops', 'questionIndex'), { items: [{ id: 'q1', t: 'Karak or flat white?', o: ['Karak', 'Flat white'] }] });
  await setDoc(doc(db, 'ops', 'daily'), { calls: {}, errors: [] });
}

export const opsCases: Case[] = [
  {
    name: 'a signed-in user can read the question index',
    expect: 'allow',
    as: PLAIN,
    seed: seedOps,
    run: (db) => getDoc(doc(db, 'ops', 'questionIndex')),
  },
  {
    name: 'the question index is not readable signed out',
    expect: 'deny',
    note: 'Denied by isAuthenticated(), shared with every other path; M82 keeps it.',
    as: 'unauthenticated',
    seed: seedOps,
    run: (db) => getDoc(doc(db, 'ops', 'questionIndex')),
  },
  {
    name: 'other operational documents are not readable',
    expect: 'deny',
    killedBy: 'M82',
    as: PLAIN,
    seed: seedOps,
    run: (db) => getDoc(doc(db, 'ops', 'daily')),
  },
  {
    name: 'a client cannot write the question index',
    expect: 'deny',
    note: 'write is false for every client; no single guard to loosen.',
    as: PLAIN,
    run: (db) => setDoc(doc(db, 'ops', 'questionIndex'), { items: [] }),
  },
];
