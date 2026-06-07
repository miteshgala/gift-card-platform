import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_READ_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  VAULT_URL: z.string().url().default('http://localhost:4001'),
  VAULT_MTLS_CERT: z.string().optional(),
  VAULT_MTLS_KEY: z.string().optional(),
  FRAUD_ENGINE_URL: z.string().url().default('http://localhost:4002'),
  FRAUD_ENGINE_TIMEOUT_MS: z.coerce.number().default(80),

  // JWT — RS256 asymmetric signing
  JWT_PRIVATE_KEY: z.string(),
  JWT_PUBLIC_KEY: z.string(),
  JWT_ACCESS_EXPIRES_SECONDS: z.coerce.number().default(900),    // 15 minutes
  JWT_REFRESH_EXPIRES_SECONDS: z.coerce.number().default(604800), // 7 days

  // Encryption key for AES-256-GCM (64 hex chars = 32 bytes)
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]+$/, 'Must be hex'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // AWS / SES
  AWS_REGION: z.string().default('us-east-1'),
  AWS_SES_FROM_EMAIL: z.string().email().default('noreply@giftcards.example.com'),
  S3_BUCKET: z.string().default('giftcard-platform-dev'),

  // OFAC / Compliance
  OFAC_API_KEY: z.string().optional(),

  // App URLs
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  // Internal metrics
  METRICS_PORT: z.coerce.number().default(9090),

  // Rate limits
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(100),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(20),
  RATE_LIMIT_BALANCE_MAX: z.coerce.number().default(30),
  RATE_LIMIT_API_KEY_MAX: z.coerce.number().default(1000),

  // Reconciliation
  RECON_VARIANCE_THRESHOLD_CENTS: z.coerce.bigint().default(100n),

  // Bull queue concurrency
  WORKER_CONCURRENCY: z.coerce.number().default(5),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error('❌ Invalid environment variables:');
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  ${key}: ${messages?.join(', ')}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
