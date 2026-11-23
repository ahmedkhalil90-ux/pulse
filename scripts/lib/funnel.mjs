/**
 * The entry funnel and feature use, as counts only. Nothing per person leaves
 * this function: it takes one row per member and returns totals.
 *
 * @param {Array<{ answers: number, member: boolean, bracket: boolean, mind: boolean }>} people
 * @param {{ entry: number, unlock: number }} gates  answers needed to open the app, and to unlock the invite link
 */
export function funnel(people, gates) {
  const n = people.length;
  const count = (f) => people.filter(f).length;
  const pct = (k) => (n ? Math.round((k / n) * 100) : null);
  const opened = count((p) => p.answers >= gates.entry);
  const unlocked = count((p) => p.answers >= gates.unlock);
  const stalled = opened - unlocked; // got in, stopped before the invite link
  const steps = {
    signedUp: { n, pct: n ? 100 : null },
    opened: { n: opened, pct: pct(opened) },
    unlocked: { n: unlocked, pct: pct(unlocked) },
    member: { n: count((p) => p.member), pct: pct(count((p) => p.member)) },
    knockout: { n: count((p) => p.bracket), pct: pct(count((p) => p.bracket)) },
    mind: { n: count((p) => p.mind), pct: pct(count((p) => p.mind)) },
  };
  // Where the most people are lost between two consecutive gates.
  const drops = [
    ['before answering 5', n - opened],
    [`between ${gates.entry} and ${gates.unlock} answers`, stalled],
  ];
  const [where, lost] = drops.sort((a, b) => b[1] - a[1])[0];
  return { steps, biggestDrop: n && lost ? { where, lost, pct: pct(lost) } : null };
}

/** Answers per visit, one decimal, or null with no visits. */
export const answersPerVisit = (answers, sessions) => (sessions ? Math.round((answers / sessions) * 10) / 10 : null);
