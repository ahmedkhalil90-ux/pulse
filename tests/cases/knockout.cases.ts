import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * Knockout brackets. picks = the 7 winners: [qf0, qf1, qf2, qf3, sf0, sf1, final].
 * Round 1 pairs are 0v1, 2v3, 4v5, 6v7.
 */
const P = { uid: 'ko-player', email: 'ko@example.com' };
const OTHER = { uid: 'ko-other', email: 'ko2@example.com' };
const BID = 'b1';
const PICKS = [0, 3, 4, 7, 3, 4, 4]; // champion: 4

type Tally = { pairs: Record<string, Record<string, number>>; champ: Record<string, number> };
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
/** The tally after one member plays `picks`, on top of `base`. */
function tally(picks: number[], base: Tally = { pairs: {}, champ: {} }): Tally {
  const out: Tally = { pairs: JSON.parse(JSON.stringify(base.pairs)), champ: { ...base.champ } };
  const p = picks;
  const matches: Array<[number, number, number]> = [[0, 1, p[0]], [2, 3, p[1]], [4, 5, p[2]], [6, 7, p[3]], [p[0], p[1], p[4]], [p[2], p[3], p[5]], [p[4], p[5], p[6]]];
  for (const [a, b, w] of matches) {
    const k = key(a, b);
    out.pairs[k] = { [a]: 0, [b]: 0, ...(out.pairs[k] ?? {}) };
    out.pairs[k][w] += 1;
  }
  out.champ[p[6]] = (out.champ[p[6]] ?? 0) + 1;
  return out;
}
const BASE = tally([1, 2, 5, 6, 1, 6, 6]); // someone else already played

async function seed(ctx: RulesTestContext, opts: { status?: string; results?: boolean; played?: boolean } = {}) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'brackets', BID), { title: 'Best striker', status: opts.status ?? 'live', contenders: Array.from({ length: 8 }, (_, i) => ({ name: `c${i}` })) });
  if (opts.results) await setDoc(doc(db, 'bracketResults', BID), BASE);
  if (opts.played) await setDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`), { bracketId: BID, picks: PICKS, createdAt: 'x' });
}
const picksDoc = (picks: number[]) => ({ bracketId: BID, picks, createdAt: '2026-11-09T00:00:00Z' });
/** The client's write: picks and the tally together. */
function play(db: any, picks: number[], results: unknown) {
  const b = writeBatch(db);
  b.set(doc(db, 'bracketPicks', `${P.uid}_${BID}`), picksDoc(picks));
  b.set(doc(db, 'bracketResults', BID), results as Record<string, unknown>);
  return b.commit();
}
const edit = (t: Tally, f: (t: Tally) => void) => { const c = JSON.parse(JSON.stringify(t)); f(c); return c; };

export const knockoutCases: Case[] = [
  {
    name: 'the first member to finish a bracket creates the tally',
    expect: 'allow', as: P, seed: (ctx) => seed(ctx),
    run: (db) => play(db, PICKS, tally(PICKS)),
  },
  {
    name: 'a member finishing adds exactly their 7 matches and champion',
    expect: 'allow', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, tally(PICKS, BASE)),
  },
  {
    name: 'a member can check whether they already played',
    expect: 'allow', as: P, seed: (ctx) => seed(ctx),
    run: (db) => getDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`)),
  },
  {
    name: 'picks that do not form a real bracket are refused',
    expect: 'deny', killedBy: 'M100', as: P, seed: (ctx) => seed(ctx),
    // The final is between 3 and 4; 0 cannot win it.
    run: (db) => setDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`), picksDoc([0, 3, 4, 7, 3, 4, 0])),
  },
  {
    name: 'picks cannot be recorded for another member',
    expect: 'deny', killedBy: 'M101', as: OTHER, seed: (ctx) => seed(ctx),
    run: (db) => setDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`), picksDoc(PICKS)),
  },
  {
    name: 'a closed bracket takes no more picks',
    expect: 'deny', killedBy: 'M102', as: P, seed: (ctx) => seed(ctx, { status: 'closed' }),
    run: (db) => setDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`), picksDoc(PICKS)),
  },
  {
    name: "another member's picks are private",
    expect: 'deny', killedBy: 'M103', as: OTHER, seed: (ctx) => seed(ctx, { played: true }),
    run: (db) => getDoc(doc(db, 'bracketPicks', `${P.uid}_${BID}`)),
  },
  {
    name: 'a member who already played cannot add to the tally again',
    expect: 'deny', killedBy: 'M104', as: P, seed: (ctx) => seed(ctx, { results: true, played: true }),
    run: (db) => setDoc(doc(db, 'bracketResults', BID), tally(PICKS, BASE)),
  },
  {
    name: 'the tally cannot gain a match the member never played',
    expect: 'deny', killedBy: 'M105', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, edit(tally(PICKS, BASE), (t) => { t.pairs['1-5'] = { 1: 0, 5: 1 }; })),
  },
  {
    name: 'a pick cannot count twice',
    expect: 'deny', killedBy: 'M106', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, edit(tally(PICKS, BASE), (t) => { t.pairs['0-1']['0'] += 1; })),
  },
  {
    name: 'the side a member did not pick cannot gain',
    expect: 'deny', killedBy: 'M107', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, edit(tally(PICKS, BASE), (t) => { t.pairs['0-1']['1'] += 1; })),
  },
  {
    name: 'a match tally cannot gain a third side',
    expect: 'deny', killedBy: 'M108', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, edit(tally(PICKS, BASE), (t) => { t.pairs['0-1']['7'] = 1; })),
  },
  {
    name: "the champion count goes to the member's own champion only",
    expect: 'deny', killedBy: 'M109', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, edit(tally(PICKS, BASE), (t) => { t.champ['4'] -= 1; t.champ['6'] += 1; })),
  },
  {
    name: 'the tally holds nothing but match counts and champions',
    expect: 'deny', killedBy: 'M110', as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => play(db, PICKS, { ...tally(PICKS, BASE), voters: [P.uid] }),
  },
  {
    name: 'the tally cannot move without the picks that justify it',
    expect: 'deny',
    note: 'Denied twice over: existsAfter and the getAfter of the picks both fail; no single guard to loosen.',
    as: P, seed: (ctx) => seed(ctx, { results: true }),
    run: (db) => setDoc(doc(db, 'bracketResults', BID), tally(PICKS, BASE)),
  },
  {
    name: 'members cannot create or edit brackets',
    expect: 'deny', note: 'write is admin-only; no single guard to loosen.', as: P,
    run: (db) => setDoc(doc(db, 'brackets', 'mine'), { title: 'x', status: 'live', contenders: [] }),
  },
  {
    name: 'a member can suggest an idea for a future bracket',
    expect: 'allow', as: P,
    run: (db) => setDoc(doc(db, 'bracketSuggestions', 's1'), { text: 'Best Amr Diab song', lang: 'en', createdAt: serverTimestamp() }),
  },
  {
    name: 'a suggestion stores no author',
    expect: 'deny', killedBy: 'M111', as: P,
    run: (db) => setDoc(doc(db, 'bracketSuggestions', 's1'), { text: 'Best Amr Diab song', uid: P.uid, createdAt: serverTimestamp() }),
  },
  {
    name: 'a suggestion is short',
    expect: 'deny', killedBy: 'M112', as: P,
    run: (db) => setDoc(doc(db, 'bracketSuggestions', 's1'), { text: 'x'.repeat(200), createdAt: serverTimestamp() }),
  },
];
