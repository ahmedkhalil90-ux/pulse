/**
 * Shared harness for the bot suites: a throwaway emulator project loaded with
 * the REAL firestore.rules, plus helpers to seed users, questions and games
 * with rules disabled. Every bot then acts through its own authenticated
 * client, so everything it does goes through the production rules.
 */
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { makeEnv } from '../../tests/helpers/env';
import type { Game } from '../../src/types';

export type Bot = { uid: string; db: Firestore; demographics: { ageRange: string; gender: string; country: string } };

const AGES = ['18-24', '25-34', '35-44'];
const GENDERS = ['Male', 'Female'];
const COUNTRIES = ['UAE', 'Egypt'];

export async function world(projectId: string): Promise<RulesTestEnvironment> {
  return makeEnv(projectId);
}

export function botsFor(env: RulesTestEnvironment, n: number, prefix = 'bot'): Bot[] {
  return Array.from({ length: n }, (_, i) => {
    const uid = `${prefix}${i}`;
    return {
      uid,
      db: env.authenticatedContext(uid).firestore() as unknown as Firestore,
      demographics: { ageRange: AGES[i % AGES.length], gender: GENDERS[i % GENDERS.length], country: COUNTRIES[i % COUNTRIES.length] },
    };
  });
}

export async function seedUsers(env: RulesTestEnvironment, bots: Bot[], credits = 0) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore() as unknown as Firestore;
    await Promise.all(bots.map(b => setDoc(doc(db, 'users', b.uid), {
      uid: b.uid, username: b.uid, isVerified: true, credits,
      demographics: b.demographics, lastLogin: new Date().toISOString(),
    })));
  });
}

export async function seedQuestion(env: RulesTestEnvironment, id: string, extra: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, 'questions', id), {
      text: 'Karak or flat white?', options: ['Karak', 'Flat white'], category: 'Food',
      authorUid: 'pulse_originals_system', isPublic: true, createdAt: new Date().toISOString(),
      status: 'live', flags: 0, random: Math.random(), ...extra,
    });
  });
}

export async function seedGame(env: RulesTestEnvironment, game: Game) {
  await env.withSecurityRulesDisabled(async ctx => {
    const { id, ...data } = game;
    await setDoc(doc(ctx.firestore() as unknown as Firestore, 'games', id), data);
  });
}

export async function readAsAdmin<T = Record<string, unknown>>(env: RulesTestEnvironment, path: string): Promise<T | undefined> {
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async ctx => {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, path));
    out = snap.exists() ? (snap.data() as T) : undefined;
  });
  return out;
}

/** Outcome of an attempted operation, for attack reports. */
export async function attempt(fn: () => Promise<unknown>): Promise<'allowed' | 'denied'> {
  try { await fn(); return 'allowed'; } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'permission-denied' || /PERMISSION_DENIED|permission|false for '|evaluation error/i.test(String(err.message))) return 'denied';
    throw e;
  }
}
