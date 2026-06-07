import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../redis/client';
import { env } from '../utils/env';
import { Request, Response } from 'express';

function makeStore(prefix: string) {
  return new RedisStore({
    // Cast: ioredis and rate-limit-redis bundle different ioredis versions with incompatible types
    sendCommand: ((...args: string[]) => {
      const [cmd, ...rest] = args;
      return redis.call(cmd!, ...(rest as Parameters<typeof redis.call>)) as Promise<string>;
    }) as unknown as (...args: string[]) => Promise<string>,
    prefix: `rl:${prefix}:`,
  });
}

function rateLimitHeaders(req: Request, res: Response, next: () => void, options: { limit: number }) {
  res.setHeader('X-RateLimit-Limit', options.limit);
  next();
}
void rateLimitHeaders; // suppress unused warning — headers set by the library

// ─── Global rate limiter: 100 req/min per IP ──────────────────────────────────
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: env.RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('global'),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  skip: (req) => !!req.headers['x-api-key'], // API key traffic has its own limiter
});

// ─── Auth limiter: 20 req/15min per IP ───────────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: 900_000,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('auth'),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' } },
});

// ─── Balance check limiter: 30 req/min per IP ─────────────────────────────────
export const balanceLimiter = rateLimit({
  windowMs: 60_000,
  max: env.RATE_LIMIT_BALANCE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('balance'),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many balance check requests' } },
});

// ─── API key limiter: 1000 req/min per key ────────────────────────────────────
export const apiKeyLimiter = rateLimit({
  windowMs: 60_000,
  max: env.RATE_LIMIT_API_KEY_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('apikey'),
  keyGenerator: (req) => {
    // Key by API key ID if present, else IP
    return (req.headers['x-api-key-id'] as string) ?? (req.ip ?? 'unknown');
  },
  message: { error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded' } },
});
