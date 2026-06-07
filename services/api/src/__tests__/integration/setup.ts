/**
 * Integration test setup.
 *
 * Runs against a real PostgreSQL database. The schema is applied with
 * `prisma db push` before the test suite starts, and all data created
 * during tests is cleaned up in afterAll hooks within each test file.
 *
 * Env vars required:
 *   DATABASE_URL — postgres connection string
 *   DATABASE_READ_URL — (defaults to DATABASE_URL)
 */

import { execSync } from 'child_process';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  // Apply the latest schema to the test database
  // Using db push (idempotent) so we don't need migration history in CI
  execSync('npx prisma db push --schema src/prisma/schema.prisma --accept-data-loss --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env },
    cwd: process.cwd(),
  });
}, 60_000);
