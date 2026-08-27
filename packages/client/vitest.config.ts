import { defineConfig } from 'vitest/config';

// Unit tests only, and deliberately in a `node` environment with no DOM: what
// gets tested here is the editor *store* — the rung index arithmetic whose
// mistakes the solver swallows silently (an out-of-range vlink is skipped, not
// thrown). Component and end-to-end coverage is Playwright's job, under
// `tests/`, which this include pattern does not reach.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
