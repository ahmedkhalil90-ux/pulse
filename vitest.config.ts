import { defineConfig } from 'vitest/config';

// Rules tests talk to one shared Firestore emulator. Suites must not run in
// parallel: they seed fixtures with security rules disabled and clear the
// emulator between tests, so concurrent files would clobber each other.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
