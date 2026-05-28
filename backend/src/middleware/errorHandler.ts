import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { sendError } from '../utils/response';
import { captureException } from '../config/sentry';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Known application errors
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    sendError(res, 422, 'VALIDATION_ERROR', 'Validation failed', err.flatten().fieldErrors);
    return;
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      sendError(res, 409, 'CONFLICT', 'A record with this data already exists');
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, 404, 'NOT_FOUND', 'Record not found');
      return;
    }
    if (err.code === 'P2003') {
      sendError(res, 400, 'FOREIGN_KEY_VIOLATION', 'Related record not found');
      return;
    }
  }

  // Unknown errors — report to Sentry and log locally
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error('Unhandled error', {
    error: message,
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });
  captureException(err, { path: req.path, method: req.method });

  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
