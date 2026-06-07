/**
 * Vitest config for integration tests.
 *
 * Requires a live PostgreSQL database. Set DATABASE_URL + DATABASE_READ_URL
 * before running. In CI this is provided by the postgres service container.
 *
 * Run with: npm run test:integration
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts', './src/__tests__/integration/setup.ts'],
    include: ['src/__tests__/integration/**/*.test.ts'],
    testTimeout: 30_000,
    // Integration tests must run serially — each test uses the same DB
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
