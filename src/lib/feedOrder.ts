import type { Question } from '../types';

/**
 * Feed ordering. The nightly ranking job (scripts/ops/rank.ts) writes
 * `rank` (0..1) and `rankTier` on every live question:
 *   top | normal | low  -- scored on enough answers and skips
 *   exploring          -- too few responses to judge yet
 *
 * A new user (fewer than NEW_USER_ANSWERS answers) sees the best questions
 * first. After that the feed mixes, per block of 10: 7 proven (by rank),
 * 2 exploring (so new questions get a fair chance to prove themselves),
 * 1 wildcard from the low tier. Boosted questions always lead.
 */
export const NEW_USER_ANSWERS = 15;
const BLOCK: Array<'proven' | 'exploring' | 'wild'> = [
  'proven', 'proven', 'exploring', 'proven', 'proven', 'proven', 'exploring', 'proven', 'proven', 'wild',
];

type Ranked = Question & { rank?: number; rankTier?: string };

export function orderFeed(questions: Ranked[], answeredCount: number): Ranked[] {
  const byRandom = (a: Ranked, b: Ranked) => (a.random || 0) - (b.random || 0);
  const byRank = (a: Ranked, b: Ranked) => (b.rank ?? 0.5) - (a.rank ?? 0.5) || byRandom(a, b);

  const boosted = questions.filter((q) => (q.boostCount || 0) > 0).sort((a, b) => (b.boostCount || 0) - (a.boostCount || 0));
  const rest = questions.filter((q) => !((q.boostCount || 0) > 0));
  const tierOf = (q: Ranked) => q.rankTier ?? 'exploring';

  const proven = rest.filter((q) => tierOf(q) === 'top' || tierOf(q) === 'normal').sort(byRank);
  const exploring = rest.filter((q) => tierOf(q) === 'exploring').sort(byRandom);
  const wild = rest.filter((q) => tierOf(q) === 'low').sort(byRandom);

  if (answeredCount < NEW_USER_ANSWERS) {
    // First impression: strongest questions first, then the usual mix.
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
    // Fall through to whichever pool still has questions.
    const order = [want, 'proven', 'exploring', 'wild'] as const;
    const pool = order.map((k) => pools[k]).find((p) => p.length > 0)!;
    out.push(pool.shift()!);
  }
  return out;
}
