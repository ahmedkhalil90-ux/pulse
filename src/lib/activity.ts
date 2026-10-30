import { doc, increment, setDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Beta tracking: per user, per day, COUNTS ONLY (sessions, answers, skips,
 * shares). Never which question, never which option, so no answer can be
 * tied to a person. Written to activity/{uid}_{YYYY-MM-DD}; the nightly job
 * (scripts/ops/metrics.mjs) turns these into retention and engagement.
 * Fire-and-forget: tracking must never break or slow the app.
 */
export type Counter = 'sessions' | 'answers' | 'skips' | 'shares';

export function track(uid: string | undefined, counter: Counter): void {
  if (!uid) return;
  const day = new Date().toISOString().slice(0, 10);
  setDoc(doc(db, 'activity', `${uid}_${day}`), { uid, day, [counter]: increment(1) }, { merge: true }).catch(() => {});
}
