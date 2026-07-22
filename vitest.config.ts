import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Convex-layer tests live OUTSIDE convex/ on purpose: the Convex CLI
    // bundles/analyzes every non-*.test.ts file under convex/ at deploy time,
    // and test helpers (import.meta.glob) break the push.
    include: ['engine/__tests__/**/*.test.ts', 'tests/convex/**/*.test.ts'],
    environment: 'node',
  },
});
