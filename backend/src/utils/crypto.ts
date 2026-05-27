import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const SALT_ROUNDS = 10;

// ─── Card Number Generation ───────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 16-digit card number (no dashes).
 * Uses Luhn-valid format for compatibility with card processors.
 */
export function generateCardNumber(): string {
  // Generate 15 random digits, then append Luhn check digit
  const digits: number[] = [];
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 15; i++) {
    digits.push(randomBytes[i % 8] % 10);
  }
  // Ensure first digit is not 0
  if (digits[0] === 0) digits[0] = crypto.randomInt(1, 9);
  digits.push(luhnCheckDigit(digits));
  return digits.join('');
}

/**
 * Generate a cryptographically secure 4-digit PIN.
 */
export function generatePin(): string {
  return String(crypto.randomInt(1000, 9999)).padStart(4, '0');
}

function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if ((digits.length - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Hash a card number using SHA-256 + HMAC with the encryption key.
 * Deterministic — used for lookups.
 */
export function hashCardNumber(cardNumber: string): string {
  return crypto
    .createHmac('sha256', env.ENCRYPTION_KEY)
    .update(cardNumber.replace(/\s|-/g, ''))
    .digest('hex');
}

/**
 * Hash a PIN with bcrypt (slow hash, suitable for auth checks).
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Verify a PIN against its bcrypt hash.
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/**
 * Hash a password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against its bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash an API key or webhook secret deterministically (SHA-256 HMAC).
 */
export function hashApiKey(key: string): string {
  return crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(key).digest('hex');
}

/**
 * Hash a refresh token (SHA-256) for storage.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Masking ──────────────────────────────────────────────────────────────────

/**
 * Return masked card number: ****-****-****-1234
 */
export function maskCardNumber(cardNumber: string): string {
  const clean = cardNumber.replace(/\s|-/g, '');
  return `****-****-****-${clean.slice(-4)}`;
}

// ─── Encryption (symmetric, for non-auth sensitive data) ─────────────────────

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(env.ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(env.ENCRYPTION_KEY), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateApiKeyValue(isSandbox: boolean): { key: string; prefix: string } {
  const prefix = isSandbox ? env.SANDBOX_KEY_PREFIX : env.LIVE_KEY_PREFIX;
  const random = crypto.randomBytes(24).toString('base64url');
  const key = `${prefix}${random}`;
  return { key, prefix: key.slice(0, prefix.length + 4) };
}
