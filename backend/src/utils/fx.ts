/**
 * FX / Exchange Rate Utility
 *
 * Fetches rates from exchangerate-api.com (free tier, USD base).
 * Caches in Redis for 1 hour. Falls back to hardcoded rates if the
 * API is unreachable (useful in dev / air-gapped environments).
 */

import { redis } from '../config/redis';
import { logger } from '../config/logger';

const CACHE_KEY = 'fx:rates:usd';
const CACHE_TTL_SECONDS = 3600; // 1 hour
const API_URL = 'https://open.er-api.com/v6/latest/USD'; // free, no key required

// Hardcoded fallback rates (approximate, USD base)
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.54,
  JPY: 149.5,
  MXN: 17.1,
  BRL: 4.97,
  INR: 83.1,
  SGD: 1.34,
  CHF: 0.89,
  HKD: 7.82,
  SEK: 10.5,
  NOK: 10.6,
  DKK: 6.88,
  NZD: 1.63,
  ZAR: 18.6,
  AED: 3.67,
};

export interface FxRates {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
  source: 'live' | 'cached' | 'fallback';
}

export async function getRates(): Promise<FxRates> {
  // 1. Try Redis cache
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as FxRates;
      return { ...parsed, source: 'cached' };
    }
  } catch {
    // Redis unavailable — continue
  }

  // 2. Try live API
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const data = await res.json() as { rates: Record<string, number>; time_last_update_utc: string };
      const rateData: FxRates = {
        base: 'USD',
        rates: data.rates,
        updatedAt: data.time_last_update_utc,
        source: 'live',
      };
      // Cache in Redis
      try {
        await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(rateData));
      } catch { /* Redis unavailable */ }
      return rateData;
    }
  } catch (err) {
    logger.warn('FX rate fetch failed, using fallback', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  // 3. Fallback to hardcoded rates
  return {
    base: 'USD',
    rates: FALLBACK_RATES,
    updatedAt: new Date().toISOString(),
    source: 'fallback',
  };
}

/**
 * Convert `amount` from `fromCurrency` to `toCurrency`.
 * Both currencies must be in the rates table (USD-based cross-rates).
 * Returns the converted amount rounded to 2 decimal places.
 */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<{ convertedAmount: number; rate: number; source: FxRates['source'] }> {
  if (fromCurrency === toCurrency) {
    return { convertedAmount: amount, rate: 1, source: 'live' };
  }

  const { rates, source } = await getRates();

  const fromRate = rates[fromCurrency.toUpperCase()];
  const toRate = rates[toCurrency.toUpperCase()];

  if (!fromRate) throw new Error(`Unsupported currency: ${fromCurrency}`);
  if (!toRate) throw new Error(`Unsupported currency: ${toCurrency}`);

  // Cross-rate via USD: amount / fromRate * toRate
  const rate = toRate / fromRate;
  const convertedAmount = Math.round(amount * rate * 100) / 100;

  return { convertedAmount, rate, source };
}

/** Returns all supported currency codes */
export async function getSupportedCurrencies(): Promise<string[]> {
  const { rates } = await getRates();
  return Object.keys(rates).sort();
}
