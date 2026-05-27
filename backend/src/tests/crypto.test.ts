import { describe, it, expect } from 'vitest';
import {
  generateCardNumber,
  generatePin,
  hashCardNumber,
  maskCardNumber,
  hashPin,
  verifyPin,
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
  generateSecureToken,
} from '../utils/crypto';

describe('Crypto Utils', () => {
  describe('generateCardNumber', () => {
    it('generates a 16-digit string', () => {
      const num = generateCardNumber();
      expect(num).toMatch(/^\d{16}$/);
    });

    it('generates unique numbers', () => {
      const nums = new Set(Array.from({ length: 100 }, () => generateCardNumber()));
      expect(nums.size).toBe(100);
    });

    it('never starts with 0', () => {
      for (let i = 0; i < 50; i++) {
        expect(generateCardNumber()[0]).not.toBe('0');
      }
    });
  });

  describe('generatePin', () => {
    it('generates a 4-digit PIN', () => {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
    });

    it('generates PINs in valid range', () => {
      for (let i = 0; i < 50; i++) {
        const pin = parseInt(generatePin());
        expect(pin).toBeGreaterThanOrEqual(1000);
        expect(pin).toBeLessThanOrEqual(9999);
      }
    });
  });

  describe('hashCardNumber', () => {
    it('is deterministic', () => {
      const num = '1234567890123456';
      expect(hashCardNumber(num)).toBe(hashCardNumber(num));
    });

    it('strips dashes before hashing', () => {
      expect(hashCardNumber('1234-5678-9012-3456')).toBe(hashCardNumber('1234567890123456'));
    });

    it('produces different hashes for different numbers', () => {
      expect(hashCardNumber('1234567890123456')).not.toBe(hashCardNumber('9876543210987654'));
    });
  });

  describe('maskCardNumber', () => {
    it('masks all but last 4 digits', () => {
      expect(maskCardNumber('1234567890123456')).toBe('****-****-****-3456');
    });
  });

  describe('hashPin / verifyPin', () => {
    it('verifies a correct PIN', async () => {
      const hash = await hashPin('1234');
      expect(await verifyPin('1234', hash)).toBe(true);
    });

    it('rejects an incorrect PIN', async () => {
      const hash = await hashPin('1234');
      expect(await verifyPin('5678', hash)).toBe(false);
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('verifies a correct password', async () => {
      const hash = await hashPassword('mysecretpassword');
      expect(await verifyPassword('mysecretpassword', hash)).toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword('mysecretpassword');
      expect(await verifyPassword('wrongpassword', hash)).toBe(false);
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext correctly', () => {
      const plaintext = 'Hello, world! 🎁';
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces different ciphertexts for same input (random IV)', () => {
      const plaintext = 'same input';
      expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
    });
  });

  describe('generateSecureToken', () => {
    it('generates hex tokens of correct length', () => {
      expect(generateSecureToken(32)).toMatch(/^[0-9a-f]{64}$/);
      expect(generateSecureToken(16)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateSecureToken()));
      expect(tokens.size).toBe(100);
    });
  });
});
