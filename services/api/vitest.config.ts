import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Exclude integration tests — those run separately with vitest.integration.config.ts
    exclude: ['**/node_modules/**', '**/dist/**', 'src/__tests__/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/prisma/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 55,
        statements: 60,
      },
    },
    // Timeout for async tests (DB ops can be slow in CI)
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
