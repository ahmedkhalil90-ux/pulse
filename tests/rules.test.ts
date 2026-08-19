import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, outcome } from './helpers/env';
import { SUITES } from './helpers/suites';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv('pulse-rules');
});

afterAll(async () => {
  await env?.cleanup();
});

for (const [collection, cases] of SUITES) {
  describe(collection, () => {
    for (const c of cases) {
      const verb = c.expect === 'allow' ? 'allows' : 'denies';
      it(`${verb}: ${c.name}`, async () => {
        expect(await outcome(env, c)).toBe(c.expect === 'allow' ? 'allowed' : 'denied');
      });
    }
  });
}
