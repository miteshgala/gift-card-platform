import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Key loaded from env — must be 64 hex chars (32 bytes)
function getKey(): Buffer {
  const hex = process.env['VAULT_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) throw new Error('VAULT_ENCRYPTION_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

const TOKENIZATION_SECRET = (): string => {
  const s = process.env['VAULT_TOKENIZATION_SECRET'];
  if (!s) throw new Error('VAULT_TOKENIZATION_SECRET is required');
  return s;
};

// ─── Deterministic tokenization ───────────────────────────────────────────────
// Same PAN always produces the same token — enables dedup without storing PANs.
// Uses HMAC-SHA-256 keyed with the tokenization secret.

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function toBase62(buf: Buffer, length: number): string {
  let num = BigInt('0x' + buf.toString('hex'));
  const chars: string[] = [];
  while (chars.length < length) {
    chars.unshift(BASE62[Number(num % 62n)] as string);
    num = num / 62n;
  }
  return chars.join('');
}

export function generateToken(pan: string, environment: 'live' | 'test'): string {
  const hmac = crypto.createHmac('sha256', TOKENIZATION_SECRET());
  hmac.update(pan);
  const digest = hmac.digest();
  const encoded = toBase62(digest, 22);
  return `tok_${environment}_${encoded}`;
}

// ─── AES-256-GCM encryption ───────────────────────────────────────────────────

export function encryptPan(pan: string): { ciphertext: string; iv: string } {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(pan, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store authTag appended to ciphertext (last 16 bytes)
  const combined = Buffer.concat([encrypted, authTag]);
  return {
    ciphertext: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptPan(ciphertext: string, ivBase64: string): string {
  const key = getKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const combined = Buffer.from(ciphertext, 'base64');
  const authTag = combined.subarray(combined.length - 16);
  const encrypted = combined.subarray(0, combined.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

// ─── Luhn validation ──────────────────────────────────────────────────────────

export function isValidPan(pan: string): boolean {
  if (!/^\d{13,19}$/.test(pan)) return false;
  const digits = pan.split('').map(Number);
  const checkDigit = digits.pop() as number;
  let sum = 0;
  let alt = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i] as number;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}
