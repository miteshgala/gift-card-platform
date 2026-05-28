import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/modules/ledger/ledger.service.ts',
        'src/modules/fraud/fraud.service.ts',
        'src/modules/cards/cards.service.ts',
        'src/utils/crypto.ts',
        'src/utils/fx.ts',
      ],
      // Route files are excluded — they have no independent logic and will be
      // covered by integration / supertest tests in a future pass.
      exclude: ['**/*.routes.ts', '**/*.test.ts', '**/node_modules/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 75,
        statements: 70,
      },
    },
    setupFiles: ['src/tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
