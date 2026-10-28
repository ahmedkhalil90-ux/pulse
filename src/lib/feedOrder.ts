import type { Question } from '../types';

/**
 * Feed ordering, personal to each user.
 *
 * Inputs from the nightly ranking job (scripts/ops/rank.ts): `rank` (0..1) and
 * `rankTier`: top | normal | low (judged on enough responses), exploring (too
 * few yet). Inputs from the user: which categories they answer vs skip, their
 * country, and their uid (for a stable personal shuffle).
 *
 * Per question:  score = rank + 0.20 x category interest + 0.08 x local fit + personal jitter
 * A new user (fewer than NEW_USER_ANSWERS answers) gets the best-scored
 * questions first. After that each block of 10 is 7 proven, 2 exploring
 * (new questions get a fair chance), 1 wildcard. Boosted questions lead.
 * Two users never see the same sequence; one user sees a stable order within
 * a day, and a fresh one the next day.
 */
export const NEW_USER_ANSWERS = 15;
const BLOCK: Array<'proven' | 'exploring' | 'wild'> = [
  'proven', 'proven', 'exploring', 'proven', 'proven', 'proven', 'exploring', 'proven', 'proven', 'wild',
];
const GULF = new Set(['UAE', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Bahrain', 'Oman']);
const GULF_CATEGORIES = new Set(['Gulf Work Life', 'Expat Life', 'City Rivalries']);

type Ranked = Question & { rank?: number; rankTier?: string; source?: string };

export type Viewer = {
  uid: string;
  country?: string;
  /** category -> interest in [-1, 1], from the user's own answers vs skips */
  interest?: Record<string, number>;
  /** changes daily so the order refreshes */
  day?: string;
};

/** Deterministic 0..1 from a string (FNV-1a). */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 0xffffffff;
}

/** How much a user likes each category: answers count +1, skips -1, smoothed. */
export function categoryInterest(answered: string[], skipped: string[]): Record<string, number> {
  const a: Record<string, number> = {}, s: Record<string, number> = {};
  for (const c of answered) a[c] = (a[c] ?? 0) + 1;
  for (const c of skipped) s[c] = (s[c] ?? 0) + 1;
  const out: Record<string, number> = {};
  for (const c of new Set([...answered, ...skipped])) {
    const n = (a[c] ?? 0) + (s[c] ?? 0);
    out[c] = ((a[c] ?? 0) - (s[c] ?? 0)) / (n + 3); // +3: a few votes don't swing it
  }
  return out;
}

function localFit(q: Ranked, country?: string): number {
  if (!country) return 0;
  if (q.source === 'trend-egypt') return country === 'Egypt' ? 1 : -0.5;
  if (q.source === 'trend-uae') return GULF.has(country) ? 1 : -0.5;
  if (GULF_CATEGORIES.has(q.category)) return GULF.has(country) ? 0.5 : -0.25;
  return 0;
}

export function orderFeed(questions: Ranked[], answeredCount: number, viewer?: Viewer): Ranked[] {
  const day = viewer?.day ?? new Date().toISOString().slice(0, 10);
  const jitter = (q: Ranked) => (viewer ? hash01(`${viewer.uid}|${q.id}|${day}`) : q.random || 0);
  const score = (q: Ranked) =>
    (q.rank ?? 0.5) + 0.2 * (viewer?.interest?.[q.category] ?? 0) + 0.08 * localFit(q, viewer?.country) + 0.06 * jitter(q);
  const byScore = (a: Ranked, b: Ranked) => score(b) - score(a);

  const boosted = questions.filter((q) => (q.boostCount || 0) > 0).sort((a, b) => (b.boostCount || 0) - (a.boostCount || 0));
  const rest = questions.filter((q) => !((q.boostCount || 0) > 0));
  const tierOf = (q: Ranked) => q.rankTier ?? 'exploring';

  const proven = rest.filter((q) => tierOf(q) === 'top' || tierOf(q) === 'normal').sort(byScore);
  // Exploring questions have no reliable rank yet: interest, local fit and the
  // personal shuffle decide, so different users test different new questions.
  const exploring = rest.filter((q) => tierOf(q) === 'exploring')
    .sort((a, b) => (score(b) - (b.rank ?? 0.5) + 0.25 * jitter(b)) - (score(a) - (a.rank ?? 0.5) + 0.25 * jitter(a)));
  const wild = rest.filter((q) => tierOf(q) === 'low').sort((a, b) => jitter(a) - jitter(b));

  if (answeredCount < NEW_USER_ANSWERS) {
    const lead = proven.splice(0, NEW_USER_ANSWERS - answeredCount);
    return [...boosted, ...lead, ...mix(proven, exploring, wild)];
  }
  return [...boosted, ...mix(proven, exploring, wild)];
}

function mix(proven: Ranked[], exploring: Ranked[], wild: Ranked[]): Ranked[] {
  const pools = { proven: [...proven], exploring: [...exploring], wild: [...wild] };
  const out: Ranked[] = [];
  const total = proven.length + exploring.length + wild.length;
  for (let i = 0; out.length < total; i++) {
    const want = BLOCK[i % BLOCK.length];
    const order = [want, 'proven', 'exploring', 'wild'] as const;
    const pool = order.map((k) => pools[k]).find((p) => p.length > 0)!;
    out.push(pool.shift()!);
  }
  return out;
}
