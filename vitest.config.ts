import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['engine/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
