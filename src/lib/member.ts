import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { t } from './i18n';

/** Answers before the rest of the app opens up. */
export const ENTRY_ANSWERS = 5;
/** Answers before the member number and personal invite link unlock. */
export const UNLOCK_ANSWERS = 10;
/** Answers before we start suggesting the member asks a question. */
export const ASK_PROMPT_ANSWERS = 15;

export const formatMemberNumber = (n: number) => `#${n}`;

/** The public name for a member: their number, else a legacy username, else "Newcomer". */
export function memberLabel(p?: { memberNumber?: number; username?: string } | null): string {
  if (p?.memberNumber) return formatMemberNumber(p.memberNumber);
  return p?.username || t('Newcomer');
}

/** Personal invite link. Works for anyone who taps it, as often as it is shared. */
export const inviteUrl = (code: string) => {
  const u = new URL('/', window.location.origin);
  u.searchParams.set('ref', code);
  return u.toString();
};

/**
 * Claim the next member number. One transaction: advance counters/members by
 * one, record memberNumbers/{n} -> uid, set the profile's memberNumber. The
 * rules check all three against each other, so numbers are unique and in
 * join order. Returns the number, or null if the counter is not set up yet
 * (the nightly job assigns it then).
 */
export async function claimMemberNumber(db: Firestore, uid: string): Promise<number | null> {
  // Numbers are handed out one at a time from a single counter, so members
  // claiming at the same moment collide. A refused claim wrote nothing and a
  // retry re-reads the counter, so retrying with a short random wait is safe.
  for (let attempt = 0; ; attempt++) {
    try {
      return await claimOnce(db, uid);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!['aborted', 'permission-denied', 'failed-precondition'].includes(code ?? '') || attempt >= 7) throw e;
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 400 * (attempt + 1)));
    }
  }
}

function claimOnce(db: Firestore, uid: string): Promise<number | null> {
  return runTransaction(db, async (tx) => {
    const counterRef = doc(db, 'counters', 'members');
    const userRef = doc(db, 'users', uid);
    const [counter, user] = [await tx.get(counterRef), await tx.get(userRef)];
    if (user.data()?.memberNumber) return user.data()!.memberNumber as number;
    if (!counter.exists()) return null;
    const n = (counter.data().last as number) + 1;
    tx.update(counterRef, { last: n });
    tx.set(doc(db, 'memberNumbers', String(n)), { uid });
    tx.update(userRef, { memberNumber: n });
    return n;
  });
}
