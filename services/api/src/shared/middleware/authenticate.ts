import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../utils/env';
import { Errors } from '../errors/AppError';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'PROGRAM_ADMIN'
  | 'PROGRAM_ANALYST'
  | 'SUPPORT_AGENT'
  | 'AUDITOR'
  | 'API_SERVICE';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  programId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    next(Errors.unauthenticated());
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
    }) as {
      sub: string;
      email: string;
      role: UserRole;
      programId: string | null;
    };

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      programId: payload.programId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(Errors.tokenExpired());
    } else {
      next(Errors.tokenInvalid());
    }
  }
}

// ─── Role-based authorization ─────────────────────────────────────────────────

export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(Errors.unauthenticated());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(Errors.forbidden());
      return;
    }
    next();
  };
}

// ─── Program scoping ──────────────────────────────────────────────────────────
// Non-SUPER_ADMIN users can only access their own program's resources.
// SUPER_ADMIN can access all programs.

export function scopeToProgram(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(Errors.unauthenticated());
    return;
  }
  if (req.user.role === 'SUPER_ADMIN') {
    next();
    return;
  }

  // For other roles, inject programId filter into request params
  const requestedProgramId = req.params['programId'] ?? (req.query['programId'] as string);
  if (requestedProgramId && requestedProgramId !== req.user.programId) {
    next(Errors.forbidden('Access to this program is not permitted'));
    return;
  }
  next();
}
