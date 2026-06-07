import crypto from 'crypto';
import { env } from './env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96-bit IV for GCM
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

// ─── AES-256-GCM Encryption ───────────────────────────────────────────────────

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(12):authTag(16):ciphertext — all base64
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivB64, tagB64, encB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

// ─── SHA-256 Hashing ──────────────────────────────────────────────────────────

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256Bytes(input: Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ─── HMAC-SHA-256 ─────────────────────────────────────────────────────────────

export function hmacSha256(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function hmacSha256Bytes(secret: Buffer, data: Buffer): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ─── Secure Random Tokens ─────────────────────────────────────────────────────

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

// ─── Constant-time comparison ─────────────────────────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Luhn algorithm for card numbers ─────────────────────────────────────────

function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  let alternate = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i] as number;
    if (alternate) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alternate = !alternate;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateCardNumber(): string {
  const digits: number[] = [];
  // First digit 1-6 (common BIN ranges; vault will assign real BIN)
  digits.push(crypto.randomInt(1, 7));
  for (let i = 1; i < 15; i++) {
    digits.push(crypto.randomInt(0, 10));
  }
  digits.push(luhnCheckDigit(digits));
  return digits.join('');
}

export function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.split('').map(Number);
  const checkDigit = digits.pop() as number;
  return luhnCheckDigit(digits) === checkDigit;
}

// ─── API Key generation ───────────────────────────────────────────────────────

export function generateApiKey(environment: 'live' | 'test'): { fullKey: string; prefix: string; hash: string } {
  const randomPart = crypto.randomBytes(30).toString('base64url').slice(0, 40);
  const fullKey = `sk_${environment}_${randomPart}`;
  const prefix = fullKey.slice(0, 12) as string;
  const hash = sha256(fullKey);
  return { fullKey, prefix, hash };
}

// ─── Invite / Reset token generation ─────────────────────────────────────────

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  return { raw, hash };
}
