import { doc, getDoc, increment, runTransaction, writeBatch, type Firestore } from 'firebase/firestore';
import { CREDIT_VALUES, reasonData, reasonRef } from './credits';

/**
 * Knockout: 8 contenders, 7 picks. Round 1 pairs are fixed (0v1, 2v3, 4v5,
 * 6v7). picks = the winners in order: [qf0, qf1, qf2, qf3, sf0, sf1, final].
 * The rules in firestore.rules (Knockout section) check exactly this shape.
 */
export type Contender = { name: string; name_ar?: string };
export type Bracket = { id: string; title: string; title_ar?: string; category?: string; contenders: Contender[]; status: 'live' | 'closed'; createdAt?: string };
export type Tally = { pairs: Record<string, Record<string, number>>; champ: Record<string, number> };

export const MATCHES = 7;
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** The two contenders of match i, given the picks so far. */
export function matchOf(i: number, picks: number[]): [number, number] {
  if (i < 4) return [2 * i, 2 * i + 1];
  if (i === 4) return [picks[0], picks[1]];
  if (i === 5) return [picks[2], picks[3]];
  return [picks[4], picks[5]];
}
export const roundOf = (i: number) => (i < 4 ? 'Quarter-final' : i < 6 ? 'Semi-final' : 'Final');

/** The community tally after adding one member's complete picks. */
export function addPicks(picks: number[], base?: Partial<Tally>): Tally {
  const out: Tally = { pairs: JSON.parse(JSON.stringify(base?.pairs ?? {})), champ: { ...(base?.champ ?? {}) } };
  for (let i = 0; i < MATCHES; i++) {
    const [a, b] = matchOf(i, picks);
    const k = pairKey(a, b);
    out.pairs[k] = { [a]: 0, [b]: 0, ...(out.pairs[k] ?? {}) };
    out.pairs[k][picks[i]] += 1;
  }
  out.champ[picks[6]] = (out.champ[picks[6]] ?? 0) + 1;
  return out;
}

/** Share of members who picked `w` in the match a-b (0..100), or null with no data. */
export function pickShare(t: Tally | null, a: number, b: number, w: number): number | null {
  const m = t?.pairs[pairKey(a, b)];
  if (!m) return null;
  const total = (m[a] ?? 0) + (m[b] ?? 0);
  return total ? Math.round(((m[w] ?? 0) / total) * 100) : null;
}

/** Pulse's champion: the contender most members crowned. */
export function communityChampion(t: Tally | null): { idx: number; pct: number; total: number } | null {
  const entries = Object.entries(t?.champ ?? {});
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const [idx, n] = entries.sort((x, y) => y[1] - x[1])[0];
  return { idx: Number(idx), pct: Math.round((n / total) * 100), total };
}

/**
 * Save a finished bracket: private picks, the community tally and the +1
 * credit, in one write.
 *
 * Once the tally exists, it moves by atomic increments in a batch. A
 * read-then-write transaction lost about four brackets in ten when a crowd
 * finished at once: the losers' writes were checked against a tally that had
 * already moved and refused (not retried). Only the very first bracket needs a
 * transaction, to create the tally. Retries are safe: a refused write wrote
 * nothing, and a bracket already saved is never sent again.
 */
export async function submitBracket(db: Firestore, uid: string, bracketId: string, picks: number[]): Promise<Tally> {
  const resultsRef = doc(db, 'bracketResults', bracketId);
  const picksRef = doc(db, 'bracketPicks', `${uid}_${bracketId}`);
  const userRef = doc(db, 'users', uid);
  const inc: Record<string, unknown> = {};
  for (let i = 0; i < MATCHES; i++) {
    const [a, b] = matchOf(i, picks);
    inc[`pairs.${pairKey(a, b)}.${picks[i]}`] = increment(1);
  }
  inc[`champ.${picks[6]}`] = increment(1);
  const picksDoc = { bracketId, picks, createdAt: new Date().toISOString() };

  for (let attempt = 0; ; attempt++) {
    try {
      if ((await getDoc(resultsRef)).exists()) {
        const b = writeBatch(db);
        b.set(picksRef, picksDoc);
        b.update(resultsRef, inc);
        b.update(userRef, { credits: increment(CREDIT_VALUES.BRACKET) });
        b.set(reasonRef(db, uid), reasonData('bracket', bracketId));
        await b.commit();
      } else {
        await runTransaction(db, async (tx) => {
          const cur = await tx.get(resultsRef);
          tx.set(picksRef, picksDoc);
          if (cur.exists()) tx.update(resultsRef, inc);
          else tx.set(resultsRef, addPicks(picks));
          tx.update(userRef, { credits: increment(CREDIT_VALUES.BRACKET) });
          tx.set(reasonRef(db, uid), reasonData('bracket', bracketId));
        });
      }
      return (await getDoc(resultsRef)).data() as Tally;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!['aborted', 'permission-denied', 'failed-precondition'].includes(code ?? '') || attempt >= 5) throw e;
      if ((await getDoc(picksRef).catch(() => null))?.exists()) return (await getDoc(resultsRef)).data() as Tally;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 300 * (attempt + 1)));
    }
  }
}
