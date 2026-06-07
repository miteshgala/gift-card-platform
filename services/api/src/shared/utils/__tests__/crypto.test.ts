/**
 * Unit tests for crypto utility functions.
 *
 * These are pure-function tests — no DB, no network, no mocks required
 * beyond the ENCRYPTION_KEY env var (set in setup.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  sha256,
  hmacSha256,
  generateSecureToken,
  safeEqual,
  generateCardNumber,
  validateLuhn,
  generateApiKey,
  generateInviteToken,
} from '../crypto';

// ─── AES-256-GCM ──────────────────────────────────────────────────────────────

describe('encrypt / decrypt', () => {
  it('round-trips arbitrary plaintext', () => {
    const plaintext = 'Hello, World! 🌍';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const plaintext = 'same input';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    // Both decrypt to same value
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it('ciphertext has the iv:tag:data format (three colon-separated parts)', () => {
    const ct = encrypt('test');
    expect(ct.split(':').length).toBe(3);
  });

  it('throws on tampered ciphertext', () => {
    const ct = encrypt('secret');
    const parts = ct.split(':');
    // Flip a byte in the ciphertext part
    parts[2] = Buffer.from(parts[2]!, 'base64')
      .map((b, i) => (i === 0 ? b ^ 0xff : b))
      .toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws on invalid format', () => {
    expect(() => decrypt('not:a:valid:format:here')).toThrow('Invalid ciphertext format');
  });

  it('encrypts empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('encrypts a 10 000-char string', () => {
    const long = 'x'.repeat(10_000);
    expect(decrypt(encrypt(long))).toBe(long);
  });
});

// ─── SHA-256 ──────────────────────────────────────────────────────────────────

describe('sha256', () => {
  it('is deterministic', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  it('returns a 64-char hex string', () => {
    expect(sha256('test')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('known vector: empty string', () => {
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('different inputs produce different hashes', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'));
  });
});

// ─── HMAC-SHA-256 ─────────────────────────────────────────────────────────────

describe('hmacSha256', () => {
  it('is deterministic for the same key + data', () => {
    const mac = hmacSha256('key', 'data');
    expect(mac).toBe(hmacSha256('key', 'data'));
  });

  it('returns a 64-char hex string', () => {
    expect(hmacSha256('secret', 'message')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is sensitive to key changes', () => {
    expect(hmacSha256('key1', 'data')).not.toBe(hmacSha256('key2', 'data'));
  });

  it('is sensitive to data changes', () => {
    expect(hmacSha256('key', 'data1')).not.toBe(hmacSha256('key', 'data2'));
  });
});

// ─── generateSecureToken ──────────────────────────────────────────────────────

describe('generateSecureToken', () => {
  it('default: 32 bytes → 64-char hex string', () => {
    const token = generateSecureToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('custom byte length', () => {
    expect(generateSecureToken(16)).toHaveLength(32);
    expect(generateSecureToken(48)).toHaveLength(96);
  });

  it('is unique on each call', () => {
    const tokens = Array.from({ length: 100 }, () => generateSecureToken());
    const unique = new Set(tokens);
    expect(unique.size).toBe(100);
  });
});

// ─── safeEqual ────────────────────────────────────────────────────────────────

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(safeEqual('short', 'longer_string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});

// ─── Luhn / Card Number ───────────────────────────────────────────────────────

describe('generateCardNumber', () => {
  it('generates a 16-digit numeric string', () => {
    const num = generateCardNumber();
    expect(num).toMatch(/^\d{16}$/);
  });

  it('passes Luhn check', () => {
    for (let i = 0; i < 50; i++) {
      expect(validateLuhn(generateCardNumber())).toBe(true);
    }
  });

  it('starts with 1–6 (valid BIN range)', () => {
    for (let i = 0; i < 50; i++) {
      const first = parseInt(generateCardNumber()[0]!, 10);
      expect(first).toBeGreaterThanOrEqual(1);
      expect(first).toBeLessThanOrEqual(6);
    }
  });
});

describe('validateLuhn', () => {
  it('returns true for known valid Visa test number', () => {
    expect(validateLuhn('4532015112830366')).toBe(true);
  });

  it('returns true for known valid Mastercard test number', () => {
    expect(validateLuhn('5425233430109903')).toBe(true);
  });

  it('returns false when check digit is wrong', () => {
    expect(validateLuhn('4532015112830367')).toBe(false); // last digit off by 1
  });

  it('returns false for a number with an incorrect check digit', () => {
    // '0000000000000001' — all-zero prefix with wrong check digit (should end in 0 for Luhn to pass)
    expect(validateLuhn('0000000000000001')).toBe(false);
  });
});

// ─── generateApiKey ───────────────────────────────────────────────────────────

describe('generateApiKey', () => {
  it('live key starts with sk_live_', () => {
    const { fullKey } = generateApiKey('live');
    expect(fullKey).toMatch(/^sk_live_/);
  });

  it('test key starts with sk_test_', () => {
    const { fullKey } = generateApiKey('test');
    expect(fullKey).toMatch(/^sk_test_/);
  });

  it('prefix is first 12 chars of fullKey', () => {
    const { fullKey, prefix } = generateApiKey('live');
    expect(prefix).toBe(fullKey.slice(0, 12));
  });

  it('hash is sha256 of fullKey', () => {
    const { fullKey, hash } = generateApiKey('test');
    expect(hash).toBe(sha256(fullKey));
  });

  it('generates unique keys', () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey('live').fullKey);
    expect(new Set(keys).size).toBe(50);
  });
});

// ─── generateInviteToken ──────────────────────────────────────────────────────

describe('generateInviteToken', () => {
  it('raw is a 64-char hex string', () => {
    const { raw } = generateInviteToken();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash is sha256 of raw', () => {
    const { raw, hash } = generateInviteToken();
    expect(hash).toBe(sha256(raw));
  });

  it('raw and hash are unique per call', () => {
    const t1 = generateInviteToken();
    const t2 = generateInviteToken();
    expect(t1.raw).not.toBe(t2.raw);
    expect(t1.hash).not.toBe(t2.hash);
  });
});
