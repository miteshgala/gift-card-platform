import { Request, Response, NextFunction } from 'express';
import { validate as isUUID } from 'uuid';
import { prisma } from '../db/prisma';
import { Errors } from '../errors/AppError';
import { sha256 } from '../utils/crypto';
import { logger } from '../utils/logger';

function normalizePath(path: string): string {
  // Replace UUIDs in paths with :id placeholder for consistent key lookup
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  // Must be called as async internally — wrap
  _idempotency(req, res, next).catch(next);
}

async function _idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.headers['idempotency-key'] as string | undefined;

  if (!key) {
    next(Errors.missingIdempotencyKey());
    return;
  }

  if (!isUUID(key)) {
    next(Errors.invalidIdempotencyKey());
    return;
  }

  const method = req.method;
  const path = normalizePath(req.path);
  const requestHash = sha256(JSON.stringify(req.body ?? {}));

  // Check for existing idempotency record
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_method_path: { key, method, path } },
  });

  if (existing) {
    // Check request body matches
    if (existing.requestHash !== requestHash) {
      next(Errors.idempotencyKeyReused());
      return;
    }
    logger.debug('Idempotency replay', { key, method, path, requestId: req.requestId });
    res.status(existing.responseStatus).json(existing.responseBody);
    return;
  }

  // Intercept the response to store it
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    // Store idempotency result (non-blocking)
    const status = res.statusCode;
    prisma.idempotencyKey
      .create({
        data: {
          key,
          method,
          path,
          responseStatus: status,
          responseBody: body as unknown as import('@prisma/client').Prisma.InputJsonValue,
          requestHash,
          expiresAt: new Date(Date.now() + 86_400_000), // 24 hours
        },
      })
      .catch((err) => logger.error('Failed to store idempotency key', { key, error: err.message }));

    return originalJson(body);
  };

  next();
}
