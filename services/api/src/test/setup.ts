/**
 * Global vitest setup — runs before every test file.
 *
 * 1. Seeds process.env with the minimum valid values so env.ts passes Zod validation.
 * 2. Silences logger output so test output stays clean.
 * 3. Resets all vi mocks between tests.
 */

import crypto from 'crypto';
import { vi, beforeEach, afterEach } from 'vitest';

// ─── 1. Generate a real RSA-2048 key pair for this test run ──────────────────
//
// jwt.sign with RS256 requires a real RSA key. We generate a fresh pair once
// per test run instead of storing a static key in source control.
// generateKeyPairSync is synchronous so it's safe to call at module level.

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

// ─── 2. Minimum valid env vars ────────────────────────────────────────────────
//
// These must be set BEFORE any module that imports env.ts is loaded, because
// env.ts runs parseEnv() at import time and calls process.exit(1) on failure.
// Vitest evaluates setupFiles before test files, so setting them here is safe.

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
process.env['DATABASE_READ_URL'] = 'postgresql://test:test@localhost:5432/test_db';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['KAFKA_BROKERS'] = 'localhost:9092';
process.env['VAULT_URL'] = 'http://localhost:4001';
process.env['FRAUD_ENGINE_URL'] = 'http://localhost:4002';
process.env['JWT_PRIVATE_KEY'] = privateKey as string;
process.env['JWT_PUBLIC_KEY'] = publicKey as string;
process.env['JWT_ACCESS_EXPIRES_SECONDS'] = '900';
process.env['JWT_REFRESH_EXPIRES_SECONDS'] = '604800';
process.env['ENCRYPTION_KEY'] = '0000000000000000000000000000000000000000000000000000000000000001';
process.env['STRIPE_SECRET_KEY'] = 'sk_test_placeholder_for_tests';
process.env['FRONTEND_URL'] = 'http://localhost:3000';
process.env['API_URL'] = 'http://localhost:4000';
process.env['RECON_VARIANCE_THRESHOLD_CENTS'] = '100';

// ─── 2. Silence logger in tests ───────────────────────────────────────────────
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── 3. Mock Kafka publish — never connect in tests ───────────────────────────
vi.mock('@/shared/kafka/client', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  TOPICS: {
    LEDGER_ENTRIES: 'ledger.entries',
    CARD_ISSUED: 'card.issued',
    ORDER_CREATED: 'order.created',
    PROGRAM_CREATED: 'program.created',
  },
}));

// ─── 4. Mock audit log — fire-and-forget, not critical for unit tests ─────────
vi.mock('@/shared/middleware/auditLog', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ─── 5. Reset mocks between tests ─────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
