import { describe, expect, it } from 'vitest';
import { majorityOf, regionSplit, weekKey } from '../src/lib/mind';

describe('mind reader helpers', () => {
  it('week key is the Monday of that week (UTC)', () => {
    expect(weekKey(new Date('2026-11-16T10:00:00Z'))).toBe('2026-11-16'); // a Monday
    expect(weekKey(new Date('2026-11-22T23:00:00Z'))).toBe('2026-11-16'); // the Sunday after
    expect(weekKey(new Date('2026-11-23T00:00:00Z'))).toBe('2026-11-23');
  });
  it('majority, and null on a tie', () => {
    expect(majorityOf(6, 4)).toBe(0); expect(majorityOf(2, 9)).toBe(1); expect(majorityOf(5, 5)).toBeNull();
  });
});

describe('Gulf vs Egypt split', () => {
  const c = (a: number, b: number) => ({ '0': a, '1': b });
  it('needs at least 10 answers on each side (anonymity minimum)', () => {
    expect(regionSplit({ UAE: c(9, 0), Egypt: c(20, 5) })).toBeNull();
    expect(regionSplit({ UAE: c(8, 4), Egypt: c(5, 4) })).toBeNull();
    expect(regionSplit(undefined)).toBeNull();
  });
  it('adds the Gulf countries together and flags a split', () => {
    const r = regionSplit({ UAE: c(6, 1), 'Saudi Arabia': c(3, 2), Egypt: c(3, 9), Jordan: c(50, 0) })!;
    expect(r.gulf).toEqual({ total: 12, lead: 0, pct: 75 });
    expect(r.egypt).toEqual({ total: 12, lead: 1, pct: 75 });
    expect(r.split).toBe(true);
  });
  it('no split when both lean the same way', () => {
    expect(regionSplit({ UAE: c(8, 2), Egypt: c(7, 3) })!.split).toBe(false);
  });
});
