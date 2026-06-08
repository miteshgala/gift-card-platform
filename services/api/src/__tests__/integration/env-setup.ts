/**
 * Env setup for integration tests.
 *
 * Sets all env vars required by env.ts EXCEPT DATABASE_URL and DATABASE_READ_URL,
 * which are injected by the CI postgres service (or by the developer locally).
 *
 * Generates a fresh RSA key pair per run — same approach as unit test setup.ts,
 * but we do NOT override DATABASE_URL here so CI can inject real credentials.
 */

import crypto from 'crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

process.env['NODE_ENV'] = 'test';
// DATABASE_URL and DATABASE_READ_URL come from the environment (CI or .env.local)
process.env['DATABASE_READ_URL'] ??= process.env['DATABASE_URL'];
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['KAFKA_BROKERS'] ??= 'localhost:9092';
process.env['VAULT_URL'] ??= 'http://localhost:4001';
process.env['FRAUD_ENGINE_URL'] ??= 'http://localhost:4002';
process.env['JWT_PRIVATE_KEY'] = privateKey as string;
process.env['JWT_PUBLIC_KEY'] = publicKey as string;
process.env['JWT_ACCESS_EXPIRES_SECONDS'] ??= '900';
process.env['JWT_REFRESH_EXPIRES_SECONDS'] ??= '604800';
process.env['ENCRYPTION_KEY'] ??= '0000000000000000000000000000000000000000000000000000000000000001';
process.env['STRIPE_SECRET_KEY'] ??= 'sk_test_placeholder_for_integration_tests';
process.env['FRONTEND_URL'] ??= 'http://localhost:3000';
process.env['API_URL'] ??= 'http://localhost:4000';
process.env['RECON_VARIANCE_THRESHOLD_CENTS'] ??= '100';
