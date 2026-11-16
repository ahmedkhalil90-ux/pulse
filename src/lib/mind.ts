import { doc, runTransaction, type Firestore } from 'firebase/firestore';

/**
 * Mind Reader: before the result is revealed, guess what most people picked.
 * The weekly score lives in users/{uid}/private/mind (counts only, private).
 */
const KEY = 'pulse.mind';
export const mindMode = {
  get(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  set(on: boolean) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } window.dispatchEvent(new Event('pulse:mind')); },
};

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekKey(d: Date = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
}

export type MindScore = { week: string; right: number; total: number };
export const mindRef = (db: Firestore, uid: string) => doc(db, 'users', uid, 'private', 'mind');

/** Count one prediction (one at a time: the rules refuse anything else). */
export async function recordPrediction(db: Firestore, uid: string, correct: boolean): Promise<MindScore> {
  const week = weekKey();
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(mindRef(db, uid));
    const cur = snap.exists() && snap.data().week === week ? (snap.data() as MindScore) : { week, right: 0, total: 0 };
    const next = { week, right: cur.right + (correct ? 1 : 0), total: cur.total + 1 };
    tx.set(mindRef(db, uid), next);
    return next;
  });
}

/** Which option leads, or null on an exact tie. */
export const majorityOf = (c0: number, c1: number): 0 | 1 | null => (c0 === c1 ? null : c0 > c1 ? 0 : 1);

const GULF = new Set(['UAE', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Bahrain', 'Oman']);
export const REGION_MIN = 10;
export type RegionSide = { total: number; lead: 0 | 1 | null; pct: number };
/**
 * Gulf vs Egypt, from the per-country counts. Each side is shown only with at
 * least REGION_MIN answers (the same minimum as every demographic breakdown).
 */
export function regionSplit(country: Record<string, Record<string, number>> | undefined): { gulf: RegionSide; egypt: RegionSide; split: boolean } | null {
  if (!country) return null;
  const side = (names: (n: string) => boolean): RegionSide => {
    let a = 0, b = 0;
    for (const [name, c] of Object.entries(country)) if (names(name)) { a += c['0'] ?? 0; b += c['1'] ?? 0; }
    const total = a + b, lead = majorityOf(a, b);
    return { total, lead, pct: total ? Math.round((Math.max(a, b) / total) * 100) : 0 };
  };
  const gulf = side((n) => GULF.has(n)), egypt = side((n) => n === 'Egypt');
  if (gulf.total < REGION_MIN || egypt.total < REGION_MIN) return null;
  return { gulf, egypt, split: gulf.lead !== null && egypt.lead !== null && gulf.lead !== egypt.lead };
}
