import rateLimit from 'express-rate-limit';
import { sendError } from '../utils/response';

// General API rate limiter
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later');
  },
});

// Stricter limiter for auth endpoints
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Too many authentication attempts');
  },
});

// Strict limiter for balance check (public endpoint)
export const balanceCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Too many balance check requests');
  },
});
