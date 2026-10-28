import { describe, expect, it } from 'vitest';
import { orderFeed, NEW_USER_ANSWERS } from '../src/lib/feedOrder';

const q = (id: string, rankTier: string, rank = 0.5, extra: Record<string, unknown> = {}) =>
  ({ id, text: id, options: ['a', 'b'], category: 'c', authorUid: 's', isPublic: true, createdAt: '', status: 'live', flags: 0, random: Math.random(), rankTier, rank, ...extra }) as any;

describe('feed ordering', () => {
  const tops = Array.from({ length: 30 }, (_, i) => q(`top${i}`, 'top', 0.9 - i * 0.001));
  const normals = Array.from({ length: 30 }, (_, i) => q(`norm${i}`, 'normal', 0.6 - i * 0.001));
  const exploring = Array.from({ length: 20 }, (_, i) => q(`exp${i}`, 'exploring'));
  const low = Array.from({ length: 10 }, (_, i) => q(`low${i}`, 'low', 0.1));
  const all = [...low, ...exploring, ...normals, ...tops];

  it('a new user sees only the best-ranked questions first', () => {
    const feed = orderFeed(all, 0);
    expect(feed.slice(0, NEW_USER_ANSWERS).every((x) => x.rankTier === 'top')).toBe(true);
    expect(feed[0].rankTier).toBe('top');
  });

  it('a regular user gets ~70% proven, ~20% exploring, ~10% low per 30 cards', () => {
    const feed = orderFeed(all, 100).slice(0, 30);
    const count = (t: string[]) => feed.filter((x) => t.includes(x.rankTier)).length;
    expect(count(['top', 'normal'])).toBe(21);
    expect(count(['exploring'])).toBe(6);
    expect(count(['low'])).toBe(3);
  });

  it('boosted questions always lead', () => {
    const feed = orderFeed([...all, q('boosted', 'low', 0.1, { boostCount: 1 })], 100);
    expect(feed[0].id).toBe('boosted');
  });

  it('keeps every question exactly once, even when tiers run out', () => {
    const feed = orderFeed([...tops.slice(0, 3), ...exploring.slice(0, 9)], 100);
    expect(new Set(feed.map((x) => x.id)).size).toBe(12);
  });

  it('unranked questions are treated as exploring', () => {
    const feed = orderFeed([q('new', undefined as any), ...tops.slice(0, 5)], 100);
    expect(feed.map((x) => x.id)).toContain('new');
  });
});

import { categoryInterest } from '../src/lib/feedOrder';

describe('personal feed order', () => {
  const pool = Array.from({ length: 60 }, (_, i) =>
    q(`q${i}`, 'exploring', 0.5, { category: ['Food Wars', 'Football', 'Money & Salary'][i % 3], random: i / 60 }));

  it('two users get different sequences', () => {
    const a = orderFeed(pool, 100, { uid: 'alice', day: '2026-10-29' }).slice(0, 10).map((x) => x.id);
    const b = orderFeed(pool, 100, { uid: 'bob', day: '2026-10-29' }).slice(0, 10).map((x) => x.id);
    expect(a).not.toEqual(b);
  });

  it('one user gets the same order all day, and a fresh one the next day', () => {
    const d1 = orderFeed(pool, 100, { uid: 'alice', day: '2026-10-29' }).map((x) => x.id);
    expect(orderFeed(pool, 100, { uid: 'alice', day: '2026-10-29' }).map((x) => x.id)).toEqual(d1);
    expect(orderFeed(pool, 100, { uid: 'alice', day: '2026-10-30' }).map((x) => x.id)).not.toEqual(d1);
  });

  it('categories a user answers rise, categories they skip sink', () => {
    const interest = categoryInterest(Array(12).fill('Football'), Array(12).fill('Money & Salary'));
    const feed = orderFeed(pool, 100, { uid: 'fan', interest }).slice(0, 15);
    const count = (c: string) => feed.filter((x) => x.category === c).length;
    expect(count('Football')).toBeGreaterThan(count('Money & Salary'));
  });

  it('Egyptian trend questions go to Egyptian users first', () => {
    const mixed = [...pool, q('eg1', 'exploring', 0.5, { source: 'trend-egypt' }), q('ae1', 'exploring', 0.5, { source: 'trend-uae' })];
    const eg = orderFeed(mixed, 100, { uid: 'u1', country: 'Egypt' }).map((x) => x.id);
    expect(eg.indexOf('eg1')).toBeLessThan(eg.indexOf('ae1'));
  });
});
