import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Redis — simulates a cold cache by default
vi.mock('../config/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') },
}));

// Mock global fetch for live API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Tests ────────────────────────────────────────────────────────────────────

import { getRates, convertAmount, getSupportedCurrencies } from '../utils/fx';
import { redis } from '../config/redis';

describe('FX Utility', () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── getRates ─────────────────────────────────────────────────────────────

  describe('getRates', () => {
    it('returns cached rates when Redis hit', async () => {
      const cached = { base: 'USD', rates: { EUR: 0.92 }, updatedAt: '2026-01-01', source: 'live' };
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(cached));

      const result = await getRates();
      expect(result.source).toBe('cached');
      expect(result.rates.EUR).toBe(0.92);
    });

    it('fetches live rates when cache is cold', async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rates: { USD: 1, EUR: 0.91, GBP: 0.79 },
          time_last_update_utc: '2026-05-27T00:00:00Z',
        }),
      });

      const result = await getRates();
      expect(result.source).toBe('live');
      expect(result.rates.EUR).toBe(0.91);
      expect(redis.setex).toHaveBeenCalled();
    });

    it('falls back to hardcoded rates when API fails', async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await getRates();
      expect(result.source).toBe('fallback');
      expect(result.rates.USD).toBe(1);
      expect(result.rates.EUR).toBeGreaterThan(0);
    });

    it('falls back when API returns non-OK status', async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

      const result = await getRates();
      expect(result.source).toBe('fallback');
    });
  });

  // ─── convertAmount ────────────────────────────────────────────────────────

  describe('convertAmount', () => {
    beforeEach(() => {
      // Use consistent live rates for conversion tests
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          rates: { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5 },
          time_last_update_utc: '2026-05-27T00:00:00Z',
        }),
      });
    });

    it('returns amount unchanged when currencies match', async () => {
      const result = await convertAmount(100, 'USD', 'USD');
      expect(result.convertedAmount).toBe(100);
      expect(result.rate).toBe(1);
    });

    it('converts USD to EUR correctly', async () => {
      const result = await convertAmount(100, 'USD', 'EUR');
      // 100 * (0.92 / 1) = 92
      expect(result.convertedAmount).toBe(92);
      expect(result.rate).toBeCloseTo(0.92, 2);
    });

    it('converts EUR to GBP via USD cross-rate', async () => {
      const result = await convertAmount(100, 'EUR', 'GBP');
      // 100 * (0.79 / 0.92) ≈ 85.87
      expect(result.convertedAmount).toBeCloseTo(85.87, 0);
    });

    it('rounds converted amount to 2 decimal places', async () => {
      const result = await convertAmount(1, 'USD', 'EUR');
      const decimals = result.convertedAmount.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    it('throws for unsupported fromCurrency', async () => {
      await expect(convertAmount(100, 'XYZ', 'USD')).rejects.toThrow('Unsupported currency: XYZ');
    });

    it('throws for unsupported toCurrency', async () => {
      await expect(convertAmount(100, 'USD', 'XYZ')).rejects.toThrow('Unsupported currency: XYZ');
    });

    it('handles case-insensitive currency codes', async () => {
      const lower = await convertAmount(100, 'usd', 'eur');
      const upper = await convertAmount(100, 'USD', 'EUR');
      expect(lower.convertedAmount).toBe(upper.convertedAmount);
    });
  });

  // ─── getSupportedCurrencies ───────────────────────────────────────────────

  describe('getSupportedCurrencies', () => {
    it('returns sorted list of currency codes', async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rates: { USD: 1, ZAR: 18.6, EUR: 0.92, AED: 3.67 },
          time_last_update_utc: '2026-05-27',
        }),
      });
      const currencies = await getSupportedCurrencies();
      expect(currencies).toEqual([...currencies].sort());
    });

    it('includes USD', async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      mockFetch.mockRejectedValueOnce(new Error('offline'));
      const currencies = await getSupportedCurrencies();
      expect(currencies).toContain('USD');
    });
  });
});
