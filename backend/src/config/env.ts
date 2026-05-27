import { z } from 'zod';
import path from 'path';
import fs from 'fs';

// Load .env manually so this works in both dev and prod
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().length(32),

  // Email
  SMTP_HOST: z.string().default('smtp.mailtrap.io'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().email().default('noreply@giftcards.example.com'),

  // Security
  MAX_PIN_ATTEMPTS: z.coerce.number().default(5),
  DEFAULT_CARD_EXPIRY_DAYS: z.coerce.number().default(365),

  // API Keys
  SANDBOX_KEY_PREFIX: z.string().default('sk_test_'),
  LIVE_KEY_PREFIX: z.string().default('sk_live_'),

  // KYC/KYB — cards with initialBalance >= this value are held PENDING until verified
  KYC_THRESHOLD: z.coerce.number().default(1000),

  // KYC webhook secret (optional — omit in dev to skip HMAC verification)
  KYC_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
