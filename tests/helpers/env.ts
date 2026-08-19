import { readFileSync } from 'node:fs';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

/** The real, unmodified rules file. Tests only ever READ this. */
export const RULES_URL = new URL('../../firestore.rules', import.meta.url);

export function readRules(): string {
  return readFileSync(RULES_URL, 'utf8');
}

/** Firestore handle as handed out by rules-unit-testing. */
export type Db = ReturnType<RulesTestContext['firestore']>;

export type Actor = { uid: string; email?: string };

export type Case = {
  /** Human-readable, used as the `it()` name and in the mutation report. */
  name: string;
  expect: 'allow' | 'deny';
  /** Who performs the write. */
  as: Actor;
  /** Fixture setup, run with security rules disabled. */
  seed?: (ctx: RulesTestContext) => Promise<void>;
  /** The operation under test. */
  run: (db: Db) => Promise<unknown>;
  /**
   * Deny-cases only: the id of the mutation that should flip this case to
   * "allowed". A deny-case with no `killedBy` is not proven load-bearing --
   * the mutation report lists it as UNPROVEN.
   */
  killedBy?: string;
  /** Why this case has no single killing mutation, when killedBy is absent. */
  note?: string;
};

function emulatorTarget() {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [host, port] = raw.split(':');
  return { host, port: Number(port) };
}

/**
 * Build a test environment. `rules` defaults to the real file; the mutation
 * harness passes a loosened copy plus its own projectId so mutants never touch
 * the data or ruleset the real suite is using.
 */
export function makeEnv(projectId: string, rules = readRules()): Promise<RulesTestEnvironment> {
  const { host, port } = emulatorTarget();
  return initializeTestEnvironment({ projectId, firestore: { rules, host, port } });
}

/**
 * Run one case and report whether the rules permitted it.
 *
 * A rejection is only reported as 'denied' if it was genuinely a rules
 * rejection -- `assertFails` re-throws anything that was not permission-denied,
 * so a broken fixture surfaces as a test error rather than masquerading as a
 * passing negative.
 */
export async function outcome(env: RulesTestEnvironment, c: Case): Promise<'allowed' | 'denied'> {
  await env.clearFirestore();
  if (c.seed) await env.withSecurityRulesDisabled(c.seed);

  const ctx = env.authenticatedContext(c.as.uid, c.as.email ? { email: c.as.email } : {});
  const op = c.run(ctx.firestore());

  let allowed = false;
  try {
    await op;
    allowed = true;
  } catch {
    // Fall through; classified below.
  }
  if (allowed) return 'allowed';

  await assertFails(op);
  return 'denied';
}
