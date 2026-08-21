import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeEnv, outcome, readRules, type Case } from './helpers/env';
import { applyMutation, MUTATIONS } from './helpers/mutations';
import { ALL_CASES, caseByName } from './helpers/suites';

/**
 * Mutation verification.
 *
 * A negative test that passes whether or not its rule exists is worse than no
 * test. For each guard in firestore.rules, this loosens that one guard in an
 * in-memory copy of the rules, loads it into a throwaway emulator project, and
 * re-runs the deny-cases that claim to depend on it. Each must flip to
 * "allowed". One that stays denied is reported as NOT KILLED and fails.
 *
 * firestore.rules is only ever read. Nothing here writes to it.
 */

type Row = { mutation: string; caseName: string; result: string };
const rows: Row[] = [];

const killers = MUTATIONS.filter((m) => !m.probe);
const probes = MUTATIONS.filter((m) => m.probe);

async function runUnderMutation(mutationId: string, cases: Case[]) {
  const mutation = MUTATIONS.find((m) => m.id === mutationId)!;
  const rules = applyMutation(readRules(), mutation);
  const env = await makeEnv(`pulse-mut-${mutationId.toLowerCase()}`, rules);
  try {
    const results: Array<[Case, 'allowed' | 'denied']> = [];
    for (const c of cases) {
      results.push([c, await outcome(env, c)]);
    }
    return results;
  } finally {
    await env.cleanup();
  }
}

describe('the mutation table and the case table agree', () => {
  it('every killedBy names a mutation that exists', () => {
    const ids = new Set(MUTATIONS.map((m) => m.id));
    const dangling = ALL_CASES.filter((c) => c.killedBy && !ids.has(c.killedBy)).map(
      (c) => `${c.name} -> ${c.killedBy}`,
    );
    // A case pointing at a deleted mutation is never verified by anything: the
    // harness iterates mutations, so the case simply drops out of the report
    // while still looking covered. That is the exact failure this suite exists
    // to prevent, so it is checked explicitly.
    expect(dangling, `deny-cases naming a mutation that no longer exists:\n${dangling.join('\n')}`).toEqual([]);
  });
});

describe('the mutation table is internally consistent', () => {
  it('has no duplicate mutation ids', () => {
    // Branches allocate mutation ids independently, so a merge can land two
    // entries under one id. runUnderMutation() resolves by first match, which
    // would silently verify a case against the wrong rule -- a green suite
    // proving nothing. This is the check that makes that impossible.
    const seen = new Map<string, number>();
    for (const m of MUTATIONS) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
    expect(dupes, `duplicate mutation ids:\n${dupes.join('\n')}`).toEqual([]);
  });

  it('every killedBy names a mutation that exists', () => {
    const ids = new Set(MUTATIONS.map((m) => m.id));
    const dangling = ALL_CASES.filter((c) => c.killedBy && !ids.has(c.killedBy)).map(
      (c) => `${c.name} -> ${c.killedBy}`,
    );
    // A case pointing at a deleted mutation is never verified by anything: the
    // harness iterates mutations, so the case drops out of the report while
    // still looking covered.
    expect(dangling, `deny-cases naming a mutation that no longer exists:\n${dangling.join('\n')}`).toEqual([]);
  });
});

describe('mutation verification: each deny-case is load-bearing', () => {
  for (const m of killers) {
    const targets = ALL_CASES.filter((c) => c.killedBy === m.id);

    it(`${m.id} kills its cases — ${m.label}`, async () => {
      expect(
        targets.length,
        `Mutation ${m.id} is not claimed by any case. Either a case lost its ` +
          `killedBy, or the mutation is dead weight.`,
      ).toBeGreaterThan(0);

      // A case that is ALREADY allowed under the real rules would report
      // "killed" no matter what the mutation did. Establish the baseline first
      // so a vacuous kill cannot be mistaken for a real one.
      const baseEnv = await makeEnv(`pulse-base-${m.id.toLowerCase()}`);
      const baseline: Array<[Case, 'allowed' | 'denied']> = [];
      try {
        for (const c of targets) baseline.push([c, await outcome(baseEnv, c)]);
      } finally {
        await baseEnv.cleanup();
      }

      for (const [c, base] of baseline) {
        if (base !== 'denied') {
          rows.push({ mutation: m.id, caseName: c.name, result: 'BASE NOT DENIED' });
        }
        expect(
          base,
          `"${c.name}" is already permitted under the real rules, so ${m.id} ` +
            `cannot prove anything about it. Fix the rule, or the case.`,
        ).toBe('denied');
      }

      for (const [c, result] of await runUnderMutation(m.id, targets)) {
        rows.push({
          mutation: m.id,
          caseName: c.name,
          result: result === 'allowed' ? 'KILLED' : 'NOT KILLED',
        });
        expect(
          result,
          `${m.id} did NOT kill "${c.name}". The rule was loosened and the ` +
            `case still fails — so that test passes with or without the rule ` +
            `it claims to cover, and proves nothing.`,
        ).toBe('allowed');
      }
    });
  }
});

describe('redundancy probes (diagnostic — survival is a finding, not a failure)', () => {
  for (const m of probes) {
    it(`${m.id} — ${m.probe!.question}`, async () => {
      const targets = m.probe!.cases.map(caseByName);
      for (const [c, result] of await runUnderMutation(m.id, targets)) {
        rows.push({
          mutation: `${m.id} (probe)`,
          caseName: c.name,
          result: result === 'allowed' ? 'load-bearing alone' : 'REDUNDANT alone',
        });
      }
      // Deliberately no assertion: this measures the rules, it does not police them.
    });
  }
});

afterAll(() => {
  const unproven = ALL_CASES.filter((c) => c.expect === 'deny' && !c.killedBy);

  const width = Math.max(...rows.map((r) => r.mutation.length), 12);
  const lines = [
    '',
    '='.repeat(78),
    'MUTATION REPORT',
    '='.repeat(78),
    ...rows.map((r) => `${r.mutation.padEnd(width)}  ${r.result.padEnd(18)}  ${r.caseName}`),
  ];

  if (unproven.length) {
    lines.push('', 'UNPROVEN deny-cases (no killing mutation declared):');
    for (const c of unproven) {
      lines.push(`  - ${c.name}`);
      if (c.note) lines.push(`      ${c.note}`);
    }
  }
  lines.push('='.repeat(78), '');
  const report = lines.join('\n');
  console.log(report);
  // Also written to disk: vitest swallows console output from file-level hooks,
  // and the report is the point of this suite. Covered by *.log in .gitignore.
  writeFileSync(new URL('../mutation-report.log', import.meta.url), report);
});
