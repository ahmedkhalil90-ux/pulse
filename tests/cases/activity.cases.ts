import { doc, increment, setDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';

const ME = { uid: 'act-me', email: 'actme@pulse.app' };
const OTHER = { uid: 'act-other', email: 'actother@pulse.app' };
const DAY = '2026-10-30';
const ref = (db: any, uid = ME.uid) => doc(db, 'activity', `${uid}_${DAY}`);

/** activity/{uid}_{day}: counts only, own document, +1 at a time. */
export const activityCases: Case[] = [
  {
    name: 'a user counts one answer on their own day',
    expect: 'allow',
    as: ME,
    run: (db) => setDoc(ref(db), { uid: ME.uid, day: DAY, answers: increment(1) }, { merge: true }),
  },
  {
    name: "a user cannot write another user's activity",
    expect: 'deny',
    killedBy: 'M86',
    as: ME,
    run: (db) => setDoc(ref(db, OTHER.uid), { uid: OTHER.uid, day: DAY, answers: increment(1) }, { merge: true }),
  },
  {
    name: 'a counter cannot jump by more than one',
    expect: 'deny',
    killedBy: 'M87',
    as: ME,
    run: (db) => setDoc(ref(db), { uid: ME.uid, day: DAY, answers: increment(50) }, { merge: true }),
  },
  {
    name: 'activity cannot carry which question was answered',
    expect: 'deny',
    killedBy: 'M88',
    as: ME,
    run: (db) => setDoc(ref(db), { uid: ME.uid, day: DAY, answers: increment(1), questionId: 'q1' }, { merge: true }),
  },
];
