/**
 * CROWD SIMULATION: hundreds of members using every feature at the same time,
 * each through their own signed-in client and the real security rules, then a
 * full audit that every number in the database adds up.
 *
 * Invite chain: founders invite the first wave; members who reach 10 answers
 * claim a number and invite the next wave. Along the way members vote, skip,
 * play Knockout, guess the majority, unlock breakdowns, buy streak freezes,
 * create and join groups, flag duplicates and send feedback. A share of them
 * also try to cheat, and every attempt must be refused.
 *
 * Size: CROWD (default 150). Runs against the emulator only.
 */
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { awardDailyBonus, awardReferral, buyStreakFreeze, unlockDemographics } from '../src/lib/credits';
import { claimMemberNumber } from '../src/lib/member';
import { submitBracket, addPicks, MATCHES, matchOf, type Tally } from '../src/lib/knockout';
import { recordPrediction } from '../src/lib/mind';
import { createGroup, joinGroupByCode } from '../src/lib/groups';
import { POLICY_VERSION } from '../src/lib/privacy';
import { clientVote } from './lib/clientVote';
import { attempt, world } from './lib/world';
import type { Bot } from './lib/world';

const CROWD = Number(process.env.CROWD ?? 150);
const FOUNDERS = 10;
const QUESTIONS = 40;
const POOL = 25; // members acting at the same moment
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

// Deterministic randomness, so a failure can be replayed.
let seed = 20261124;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;

const AGES = ['13-17', '18-24', '25-34', '35-44', '45+'];
const GENDERS = ['Male', 'Female'];
const COUNTRIES = ['UAE', 'Egypt', 'Saudi Arabia', 'Kuwait', 'Jordan'];

type Member = Bot & {
  code: string; inviter?: string; answered: Map<string, 0 | 1>; credits: number; number?: number;
  bracket?: number[]; mind: { right: number; total: number }; freezes: number; unlocks: number;
  groups: Set<string>; founder: boolean;
};

let env: RulesTestEnvironment;
const members: Member[] = [];
const fails: Record<string, number> = {};
const failSamples: Record<string, string> = {};
const attacks: Array<{ name: string; outcome: string }> = [];
const timings: number[] = [];
const fail = (kind: string, e: unknown) => {
  fails[kind] = (fails[kind] ?? 0) + 1;
  failSamples[kind] ??= String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160);
};

async function pool<T>(items: T[], fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
const admin = <R,>(fn: (db: Firestore) => Promise<R>) => {
  let out!: R;
  return env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore() as unknown as Firestore); }).then(() => out);
};

function newMember(i: number, founder: boolean): Member {
  const uid = `${founder ? 'founder' : 'm'}${i}`;
  return {
    uid, db: env.authenticatedContext(uid).firestore() as unknown as Firestore,
    demographics: { ageRange: pick(AGES), gender: pick(GENDERS), country: pick(COUNTRIES) },
    code: `C${String(i).padStart(4, '0')}${founder ? 'F' : 'M'}`, answered: new Map(), credits: 0,
    mind: { right: 0, total: 0 }, freezes: 0, unlocks: 0, groups: new Set(), founder,
  };
}

/** Sign-up as the app does it: invite-gated profile, then the referral code mapping. */
async function signUp(m: Member, inviterCode: string) {
  await setDoc(doc(m.db, 'users', m.uid), {
    isVerified: false, credits: 13, demographics: m.demographics, lastLogin: today, streak: 1,
    referralCode: m.code, invitedWith: inviterCode, consentVersion: POLICY_VERSION,
  });
  m.credits = 13;
  await setDoc(doc(m.db, 'referralCodes', m.code), { uid: m.uid });
  if (chance(0.6)) {
    const inviterUid = (await getDoc(doc(m.db, 'referralCodes', inviterCode))).data()!.uid as string;
    await awardReferral(m.db, m.uid, inviterUid, inviterCode);
    m.credits += 15; m.inviter = inviterUid;
  }
}

const qid = (n: number) => `cq${n}`;

async function journey(m: Member) {
  const t0 = Date.now();
  // Feed: 12 to 20 answers, a few skips, each answer timed.
  const n = 12 + Math.floor(rnd() * 9);
  const order = Array.from({ length: QUESTIONS }, (_, i) => i).sort(() => rnd() - 0.5).slice(0, n + 3);
  for (const [k, i] of order.entries()) {
    const q = qid(i);
    if (k < 3 && chance(0.5)) {
      await setDoc(doc(m.db, 'skipped_questions', `${m.uid}_${q}`), { userId: m.uid, questionId: q, skippedAt: new Date().toISOString() })
        .catch((e) => fail('skip', e));
      continue;
    }
    if (m.answered.size >= n) break;
    // Popular questions lean one way, so majorities and rare takes exist.
    const opt = (rnd() < (i % 3 === 0 ? 0.7 : 0.45) ? 0 : 1) as 0 | 1;
    const s = Date.now();
    try { await clientVote(m, q, opt); m.answered.set(q, opt); m.credits += 1; timings.push(Date.now() - s); } catch (e) { fail('vote', e); }
  }

  // Member number at 10 answers (the app tries once; the nightly job backfills).
  if (m.answered.size >= 10 && !m.founder) {
    try { m.number = (await claimMemberNumber(m.db, m.uid)) ?? undefined; } catch (e) { fail('member number', e); }
  }

  // Knockout.
  if (chance(0.6)) {
    const picks: number[] = [];
    for (let i = 0; i < MATCHES; i++) { const [a, b] = matchOf(i, picks); picks.push(chance(0.65) ? Math.min(a, b) : Math.max(a, b)); }
    try { await submitBracket(m.db, m.uid, 'kb1', picks); m.bracket = picks; m.credits += 1; } catch (e) { fail('bracket', e); }
  }

  // Mind Reader: three guesses.
  if (chance(0.3)) {
    for (let g = 0; g < 3; g++) {
      const right = chance(0.6);
      try { await recordPrediction(m.db, m.uid, right); m.mind.total++; if (right) m.mind.right++; } catch (e) { fail('mind reader', e); }
    }
  }

  // Unlock a breakdown on something answered.
  if (chance(0.2) && m.answered.size) {
    const q = [...m.answered.keys()][0];
    try { if (await unlockDemographics(m.db, m.uid, q)) { m.credits -= 3; m.unlocks++; } } catch (e) { fail('unlock', e); }
  }

  // Streak freeze.
  if (chance(0.15)) {
    try { await buyStreakFreeze(m.db, m.uid); m.credits -= 5; m.freezes++; } catch (e) { fail('streak freeze', e); }
  }

  // Groups: join one of the founders' groups by code.
  if (chance(0.35)) {
    // A creator is already in their own group (and is told so), so pick another.
    const g = pick(groupCodes.filter((x) => x.admin !== m.uid));
    try { const joined = await joinGroupByCode(m.db, m.uid, g.code); m.groups.add(joined.id); } catch (e) { fail('join group', e); }
  }

  // Flag a question as already asked, send feedback.
  if (chance(0.1)) await updateDoc(doc(m.db, 'questions', qid(Math.floor(rnd() * QUESTIONS))), { flags_duplicate: increment(1) }).catch((e) => fail('flag duplicate', e));
  if (chance(0.05)) {
    await setDoc(doc(m.db, 'feedback', `fb_${m.uid}`), { uid: m.uid, text: 'Love it', kind: 'idea', createdAt: serverTimestamp() }).catch((e) => fail('feedback', e));
  }

  // One in ten also tries to cheat. Every attempt must be refused.
  if (chance(0.1) && m.answered.size) await cheat(m);
  timings.push(-(Date.now() - t0)); // negative = whole journey, kept apart
}

async function cheat(m: Member) {
  const victim = pick(members.filter((x) => x !== m && x.answered.size));
  const q = [...m.answered.keys()][0];
  const tries: Array<[string, () => Promise<unknown>]> = [
    ['replay a vote', () => updateDoc(doc(m.db, 'results', q), { [`counts.${m.answered.get(q)}`]: increment(1) })],
    ['grant yourself credits', () => updateDoc(doc(m.db, 'users', m.uid), { credits: increment(500) })],
    ['claim an answer credit twice', () => {
      const b = writeBatch(m.db);
      b.update(doc(m.db, 'users', m.uid), { credits: increment(1) });
      b.set(doc(m.db, 'users', m.uid, 'private', 'credit'), { reason: 'answer', ref: q, at: serverTimestamp() });
      return b.commit();
    }],
    ["read someone else's answer", () => getDoc(doc(m.db, 'user_answers', `${victim?.uid}_${[...(victim?.answered.keys() ?? [])][0]}`))],
    ["read someone else's bracket picks", () => getDoc(doc(m.db, 'bracketPicks', `${victim?.uid}_kb1`))],
    ['list every user', () => getDocs(collection(m.db, 'users'))],
    ['list every group membership', () => getDocs(collectionGroup(m.db, 'members'))],
    ['type in a 100-day streak', () => updateDoc(doc(m.db, 'users', m.uid), { streak: 100 })],
    ['give yourself the Asker badge', () => updateDoc(doc(m.db, 'users', m.uid), { asker: true })],
    ['read the waitlist', () => getDocs(collection(m.db, 'waitlist'))],
  ];
  for (const [name, fn] of tries) attacks.push({ name, outcome: await attempt(fn).catch((e) => `error: ${String(e).slice(0, 80)}`) });
}

let groupCodes: Array<{ id: string; code: string; admin: string }> = [];

beforeAll(async () => {
  env = await world('pulse-crowd');
  await env.clearFirestore();
  // Questions, one live Knockout, founders who already hold numbers (#1-#10)
  // and last opened the app yesterday.
  await admin(async (db) => {
    for (let i = 0; i < QUESTIONS; i++) {
      await setDoc(doc(db, 'questions', qid(i)), {
        text: `Crowd question ${i}?`, options: ['A', 'B'], category: 'Would You Rather', authorUid: 'pulse_originals_system',
        isPublic: true, createdAt: new Date().toISOString(), status: 'live', flags: 0, random: i / QUESTIONS,
      });
    }
    await setDoc(doc(db, 'brackets', 'kb1'), { title: 'Best striker', status: 'live', createdAt: new Date().toISOString(), contenders: Array.from({ length: 8 }, (_, i) => ({ name: `P${i}` })) });
    await setDoc(doc(db, 'counters', 'members'), { last: FOUNDERS });
  });
  for (let i = 0; i < FOUNDERS; i++) {
    const f = newMember(i, true);
    f.number = i + 1; f.credits = 50;
    members.push(f);
    await admin(async (db) => {
      await setDoc(doc(db, 'users', f.uid), { credits: 50, demographics: f.demographics, lastLogin: yesterday, streak: 4, referralCode: f.code, memberNumber: f.number, consentVersion: POLICY_VERSION });
      await setDoc(doc(db, 'referralCodes', f.code), { uid: f.uid });
      await setDoc(doc(db, 'memberNumbers', String(f.number)), { uid: f.uid });
    });
  }
}, 120000);

afterAll(async () => { await env?.cleanup(); });

describe(`crowd: ${CROWD} members using everything at once`, () => {
  it('runs the whole crowd', async () => {
    const founders = members.filter((m) => m.founder);
    // Founders: daily bonus fired twice at once (two phones), then each makes a group.
    // The duplicate is either told "already claimed" or refused by the rules;
    // either way it must never pay twice (checked in the balance audit).
    await Promise.allSettled(founders.flatMap((f) => [awardDailyBonus(f.db, f.uid), awardDailyBonus(f.db, f.uid)]));
    founders.forEach((f) => { f.credits += 3; });
    groupCodes = await Promise.all(founders.slice(0, 5).map(async (f) => {
      const g = await createGroup(f.db, f.uid, `Group of ${f.uid}`);
      f.groups.add(g.id);
      return { id: g.id, code: g.inviteCode, admin: f.uid };
    }));
    await pool(founders, journey);

    // Waves: each joiner is invited by someone who already holds a number.
    let next = 0;
    while (next < CROWD) {
      const inviters = members.filter((m) => m.number);
      const wave = Array.from({ length: Math.min(POOL * 2, CROWD - next) }, () => newMember(next++, false));
      await pool(wave, async (m) => {
        try { await signUp(m, pick(inviters).code); } catch (e) { fail('sign-up', e); return; }
        members.push(m);
        await journey(m);
      });
    }
  }, 900000);

  it('nobody doing something legitimate was refused', () => {
    console.log('\nCROWD REPORT');
    console.log(`  members: ${members.length} (${FOUNDERS} founders), answers: ${members.reduce((s, m) => s + m.answered.size, 0)}`);
    const votes = timings.filter((t) => t >= 0).sort((a, b) => a - b);
    if (votes.length) console.log(`  vote time: median ${votes[Math.floor(votes.length / 2)]} ms, 95th percentile ${votes[Math.floor(votes.length * 0.95)]} ms`);
    console.log(`  refused legitimate actions: ${JSON.stringify(fails)}`);
    for (const [k, v] of Object.entries(failSamples)) console.log(`    ${k}: ${v}`);
    // Member number claims contend on one counter; the nightly job assigns any
    // the app could not. Everything else must never fail.
    const { 'member number': _claims, ...rest } = fails;
    expect(rest).toEqual({});
  });

  it('every attempt to cheat was refused', () => {
    const got = attacks.filter((a) => a.outcome !== 'denied');
    console.log(`  cheating attempts: ${attacks.length}, refused: ${attacks.length - got.length}`);
    expect(got).toEqual([]);
  });

  it('every vote is counted exactly once, on the right option and group', async () => {
    const { results, answers, profiles } = await admin(async (db) => ({
      results: Object.fromEntries((await getDocs(collection(db, 'results'))).docs.map((d) => [d.id, d.data()])),
      answers: (await getDocs(collection(db, 'user_answers'))).docs.map((d) => d.data()),
      profiles: Object.fromEntries((await getDocs(collection(db, 'users'))).docs.map((d) => [d.id, d.data()])),
    }));
    const expected: Record<string, any> = {};
    for (const a of answers) {
      const e = (expected[a.questionId] ??= { counts: { '0': 0, '1': 0 }, demographics: { ageRange: {}, gender: {}, country: {} } });
      e.counts[a.answerIndex] += 1;
      for (const k of ['ageRange', 'gender', 'country']) {
        const bucket = profiles[a.userId].demographics[k];
        e.demographics[k][bucket] ??= { '0': 0, '1': 0 };
        e.demographics[k][bucket][a.answerIndex] += 1;
      }
    }
    const norm = (r: any) => ({
      counts: { '0': r?.counts?.['0'] ?? 0, '1': r?.counts?.['1'] ?? 0 },
      demographics: Object.fromEntries(['ageRange', 'gender', 'country'].map((k) => [k, Object.fromEntries(Object.entries(r?.demographics?.[k] ?? {}).map(([b, c]: any) => [b, { '0': c['0'] ?? 0, '1': c['1'] ?? 0 }]))])),
    });
    // Key order differs between the two; compare with sorted keys.
    const stable = (v: any): string => (v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(',')}}` : String(v));
    const mismatched = Object.keys({ ...expected, ...results }).filter((q) => stable(norm(results[q])) !== stable(norm(expected[q])));
    expect(mismatched).toEqual([]);
    expect(answers.length).toBe(members.reduce((s, m) => s + m.answered.size, 0));
  });

  it('every balance matches what the member earned and spent, and none is negative', async () => {
    const live = await admin(async (db) => Object.fromEntries((await getDocs(collection(db, 'users'))).docs.map((d) => [d.id, d.data()])));
    // Inviters were credited +15 by the nightly job, not here: the app never pays them directly.
    const wrong = members.filter((m) => live[m.uid]?.credits !== m.credits).map((m) => `${m.uid}: expected ${m.credits}, found ${live[m.uid]?.credits}`);
    expect(wrong).toEqual([]);
    expect(Object.values(live).filter((u: any) => u.credits < 0)).toEqual([]);
    const freezes = members.filter((m) => (live[m.uid]?.freezes ?? 0) !== m.freezes);
    expect(freezes.map((m) => m.uid)).toEqual([]);
  });

  it('member numbers are unique, gap-free and match their records', async () => {
    const { counter, numbers, profiles } = await admin(async (db) => ({
      counter: (await getDoc(doc(db, 'counters', 'members'))).data()!.last as number,
      numbers: (await getDocs(collection(db, 'memberNumbers'))).docs.map((d) => [Number(d.id), d.data().uid] as const),
      profiles: (await getDocs(collection(db, 'users'))).docs.map((d) => [d.id, d.data().memberNumber] as const).filter(([, n]) => n),
    }));
    const held = profiles.map(([, n]) => n).sort((a, b) => a - b);
    console.log(`  member numbers: ${held.length} issued, counter at ${counter}, claims the app could not make: ${fails['member number'] ?? 0}`);
    expect(new Set(held).size).toBe(held.length);
    expect(held).toEqual(Array.from({ length: counter }, (_, i) => i + 1));
    const byNumber = new Map(numbers);
    expect(profiles.filter(([uid, n]) => byNumber.get(n) !== uid)).toEqual([]);
  });

  it('the Knockout tally equals the sum of everyone\'s private picks', async () => {
    const { tally, picks } = await admin(async (db) => ({
      tally: (await getDoc(doc(db, 'bracketResults', 'kb1'))).data() as Tally,
      picks: (await getDocs(collection(db, 'bracketPicks'))).docs.map((d) => d.data().picks as number[]),
    }));
    let expected: Tally = { pairs: {}, champ: {} };
    for (const p of picks) expected = addPicks(p, expected);
    // Increments only write counts that moved; a missing count reads as zero.
    const noZeros = (t: Tally) => ({
      pairs: Object.fromEntries(Object.entries(t.pairs).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, n]) => n))])),
      champ: Object.fromEntries(Object.entries(t.champ).filter(([, n]) => n)),
    });
    expect(noZeros(tally)).toEqual(noZeros(expected));
    expect(picks.length).toBe(members.filter((m) => m.bracket).length);
  });

  it('Mind Reader scores match the guesses made', async () => {
    const live = await admin(async (db) => Object.fromEntries(await Promise.all(members.map(async (m) => [m.uid, (await getDoc(doc(db, 'users', m.uid, 'private', 'mind'))).data()]))));
    const wrong = members.filter((m) => m.mind.total && (live[m.uid]?.total !== m.mind.total || live[m.uid]?.right !== m.mind.right));
    expect(wrong.map((m) => m.uid)).toEqual([]);
  });

  it('group counts match their members, and everyone finds their own groups', async () => {
    const groups = await admin(async (db) => Promise.all(groupCodes.map(async (g) => ({
      id: g.id, count: (await getDoc(doc(db, 'groups', g.id))).data()!.memberCount,
      members: (await getDocs(collection(db, 'groups', g.id, 'members'))).size,
    }))));
    expect(groups.filter((g) => g.count !== g.members)).toEqual([]);
    // "My groups" through each member's own client, as the app runs it.
    const lost: string[] = [];
    await pool(members.filter((m) => m.groups.size), async (m) => {
      const mine = await getDocs(query(collectionGroup(m.db, 'members'), where('uid', '==', m.uid)));
      const ids = new Set(mine.docs.map((d) => d.ref.parent.parent!.id));
      for (const g of m.groups) if (!ids.has(g)) lost.push(`${m.uid} lost ${g}`);
    });
    expect(lost).toEqual([]);
  });
});
