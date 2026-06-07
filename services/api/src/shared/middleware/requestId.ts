import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
