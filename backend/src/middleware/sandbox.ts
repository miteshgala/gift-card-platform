import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AppError } from './errorHandler';
import { env } from '../config/env';
import { hashApiKey } from '../utils/crypto';

// Augment the Express Request type so downstream handlers can read sandboxMode
declare global {
  namespace Express {
    interface Request {
      sandboxMode?: boolean;
      resolvedApiKeyId?: string;
    }
  }
}

/**
 * Resolves the x-api-key header to an ApiKey record.
 * Attaches req.sandboxMode = apiKey.isSandbox.
 * Validates that sandbox keys only access sandbox programs and vice-versa.
 * If no API key header is present, this middleware is a no-op (JWT auth path).
 */
export async function resolveSandboxMode(req: Request, res: Response, next: NextFunction) {
  const rawKey = req.headers['x-api-key'] as string | undefined;
  if (!rawKey) return next(); // JWT path — sandbox flag not applicable at middleware level

  try {
    const keyHash = hashApiKey(rawKey);
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, isSandbox: true, isActive: true, programId: true, expiresAt: true },
    });

    if (!apiKey || !apiKey.isActive) {
      throw new AppError(401, 'INVALID_API_KEY', 'Invalid or revoked API key');
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new AppError(401, 'API_KEY_EXPIRED', 'API key has expired');
    }

    req.sandboxMode = apiKey.isSandbox;
    req.resolvedApiKeyId = apiKey.id;

    // Update last-used timestamp (fire and forget)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Call this helper inside service methods that receive a programId to ensure
 * the program's sandbox mode matches the request's sandbox mode.
 * Throws 403 if there's a mismatch (live key hitting sandbox program or vice versa).
 */
export async function assertSandboxConsistency(programId: string, requestSandbox: boolean | undefined) {
  if (requestSandbox === undefined) return; // JWT auth — no API key sandbox check

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { isSandbox: true, name: true },
  });

  if (!program) return; // program-not-found handled elsewhere

  if (program.isSandbox && !requestSandbox) {
    throw new AppError(403, 'SANDBOX_MISMATCH',
      'This program is a sandbox program. Use a sandbox API key (sk_test_...) to access it.');
  }
  if (!program.isSandbox && requestSandbox) {
    throw new AppError(403, 'SANDBOX_MISMATCH',
      'This program is a live program. Use a live API key (sk_live_...) to access it.');
  }
}

/**
 * Express middleware that enforces sandbox/live key isolation for
 * routes that include a programId in the body or query.
 */
export function requireSandboxConsistency(getprogramId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const programId = getprogramId(req);
      if (programId) await assertSandboxConsistency(programId, req.sandboxMode);
      next();
    } catch (err) {
      next(err);
    }
  };
}
