import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTRY_ANSWERS, UNLOCK_ANSWERS } from '../src/lib/member';
import { answersPerVisit, funnel } from '../scripts/lib/funnel.mjs';

const gates = { entry: 5, unlock: 10 };
const p = (answers: number, extra: Partial<{ member: boolean; bracket: boolean; mind: boolean }> = {}) =>
  ({ answers, member: false, bracket: false, mind: false, ...extra });

describe('nightly funnel', () => {
  it('counts each gate at its exact threshold', () => {
    const f = funnel([p(4), p(5), p(9), p(10, { member: true }), p(30, { member: true, bracket: true })], gates);
    expect(f.steps.signedUp).toEqual({ n: 5, pct: 100 });
    expect(f.steps.opened).toEqual({ n: 4, pct: 80 });
    expect(f.steps.unlocked).toEqual({ n: 2, pct: 40 });
    expect(f.steps.member).toEqual({ n: 2, pct: 40 });
    expect(f.steps.knockout).toEqual({ n: 1, pct: 20 });
    expect(f.steps.mind).toEqual({ n: 0, pct: 0 });
  });

  it('names the step that loses the most people', () => {
    expect(funnel([p(6), p(7), p(8), p(12), p(1)], gates).biggestDrop).toEqual({ where: 'between 5 and 10 answers', lost: 3, pct: 60 });
    expect(funnel([p(0), p(1), p(2), p(12)], gates).biggestDrop).toEqual({ where: 'before answering 5', lost: 3, pct: 75 });
  });

  it('reports nothing for an empty or loss-free funnel', () => {
    expect(funnel([], gates)).toEqual({ steps: expect.any(Object), biggestDrop: null });
    expect(funnel([], gates).steps.opened.pct).toBeNull();
    expect(funnel([p(10), p(20)], gates).biggestDrop).toBeNull();
  });

  it('answers per visit', () => {
    expect(answersPerVisit(25, 4)).toBe(6.3);
    expect(answersPerVisit(5, 0)).toBeNull();
  });

  it('the nightly job uses the same gates as the app', () => {
    expect(readFileSync('scripts/ops/metrics.mjs', 'utf8')).toContain(`const GATES = { entry: ${ENTRY_ANSWERS}, unlock: ${UNLOCK_ANSWERS} };`);
  });
});
