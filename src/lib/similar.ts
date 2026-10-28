/**
 * Near-duplicate detection for questions, shared idea with the moderation bot
 * (scripts/ops/ai-daily.mjs keeps a copy of the same scoring).
 *
 * Word overlap (Jaccard) on content words, English and Arabic, ignoring
 * question filler ("do you", "would you rather"), plus a bonus when the two
 * options match in either order. 1 = identical, 0 = unrelated.
 */
const STOP = new Set(('do does did you your youre would rather the and for with are is was what which who how have has ever more than think thought '
  + 'about prefer better like any one this that its into from will can should could when where why there their them they get got '
  + 'each every some much many very really just still also '
  + 'هل انت أنت ولا او أو في على من الى إلى عن مع اللي ايه إيه كده ولا ام أم').split(' '));

// Light English stemming so monthly/month, parents/parent, eating/eat meet.
const stem = (w: string) => /^[a-z]+$/.test(w) ? w.replace(/(ly|ing|ed|es|s)$/, '') : w;

export function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[\u060c\u061b\u061f\u066a-\u066d\u06d4]/g, ' ') // Arabic punctuation
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

const optKey = (o: string[]) => o.map((x) => tokens(x).join(' ')).filter(Boolean).sort().join('|');

export function similarity(aText: string, aOpts: string[], bText: string, bOpts: string[]): number {
  const base = jaccard(tokens(aText), tokens(bText));
  const sameOptions = aOpts.length === 2 && bOpts.length === 2 && optKey(aOpts) !== '' && optKey(aOpts) === optKey(bOpts);
  return Math.min(1, base + (sameOptions ? 0.25 : 0));
}

export type IndexItem = { id: string; t: string; o: [string, string] };

/** Best match at or above `threshold`, or null. */
export function findSimilar(text: string, opts: string[], index: IndexItem[], threshold = 0.5): (IndexItem & { score: number }) | null {
  let best: (IndexItem & { score: number }) | null = null;
  for (const item of index) {
    const score = similarity(text, opts, item.t, item.o);
    if (score >= threshold && (!best || score > best.score)) best = { ...item, score };
  }
  return best;
}
