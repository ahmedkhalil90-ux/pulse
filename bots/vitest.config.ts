import { defineConfig } from 'vitest/config';

// Bot suites share one emulator; run files serially like the main suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bots/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
