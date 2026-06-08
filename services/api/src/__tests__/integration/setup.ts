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
import { beforeAll, vi } from 'vitest';

// Silence logger output — not useful in integration tests
vi.mock('@/shared/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock Redis — integration tests use the real DB but not a real Redis instance
// Cache misses are fine: getBalance will recompute from journal lines
vi.mock('@/shared/redis/client', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),   // always cache-miss → read from DB
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  },
}));

// Mock Kafka publish — integration tests don't need a running Kafka broker
vi.mock('@/shared/kafka/client', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  TOPICS: {
    LEDGER_ENTRIES: 'ledger.entries',
    CARD_ISSUED: 'card.issued',
    ORDER_CREATED: 'order.created',
    PROGRAM_CREATED: 'program.created',
  },
}));

// Mock audit log — fire-and-forget, not needed for ledger integration correctness
vi.mock('@/shared/middleware/auditLog', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  // Apply the latest schema to the test database
  // Using db push (idempotent) so we don't need migration history in CI
  execSync('npx prisma db push --schema src/prisma/schema.prisma --accept-data-loss --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env },
    cwd: process.cwd(),
  });
}, 60_000);
