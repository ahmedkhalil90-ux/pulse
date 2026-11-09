import { doc, increment, runTransaction, type Firestore } from 'firebase/firestore';
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

/** Save a finished bracket: private picks, the community tally and the +1 credit, in one write. */
export async function submitBracket(db: Firestore, uid: string, bracketId: string, picks: number[]): Promise<Tally> {
  const resultsRef = doc(db, 'bracketResults', bracketId);
  return runTransaction(db, async (tx) => {
    const cur = await tx.get(resultsRef);
    const next = addPicks(picks, cur.exists() ? (cur.data() as Tally) : undefined);
    tx.set(doc(db, 'bracketPicks', `${uid}_${bracketId}`), { bracketId, picks, createdAt: new Date().toISOString() });
    tx.set(resultsRef, next);
    tx.update(doc(db, 'users', uid), { credits: increment(CREDIT_VALUES.BRACKET) });
    tx.set(reasonRef(db, uid), reasonData('bracket', bracketId));
    return next;
  });
}
