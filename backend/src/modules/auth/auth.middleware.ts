import { Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../../types';
import { verifyAccessToken } from './auth.service';
import { sendError } from '../../utils/response';
import { prisma } from '../../config/prisma';
import { hashApiKey } from '../../utils/crypto';

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

const ROLE_RANK: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  PROGRAM_ADMIN: 80,
  FINANCE: 60,
  MARKETING: 50,
  SUPPORT: 40,
  READ_ONLY: 10,
};

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    sendError(res, 401, 'INVALID_TOKEN', 'Access token is invalid or expired');
  }
}

// ─── API Key Auth Middleware ──────────────────────────────────────────────────

export function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const key = req.headers['x-api-key'] as string | undefined;
  if (!key) {
    sendError(res, 401, 'UNAUTHORIZED', 'API key required');
    return;
  }

  const keyHash = hashApiKey(key);

  prisma.apiKey
    .findUnique({
      where: { keyHash },
      select: { id: true, programId: true, isSandbox: true, isActive: true, expiresAt: true },
    })
    .then((apiKey) => {
      if (!apiKey || !apiKey.isActive) {
        sendError(res, 401, 'INVALID_API_KEY', 'API key is invalid or revoked');
        return;
      }
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        sendError(res, 401, 'API_KEY_EXPIRED', 'API key has expired');
        return;
      }

      req.apiKey = {
        id: apiKey.id,
        programId: apiKey.programId,
        isSandbox: apiKey.isSandbox,
      };

      // Update lastUsedAt asynchronously
      prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      next();
    })
    .catch(() => sendError(res, 500, 'INTERNAL_ERROR', 'Authentication error'));
}

// ─── Combined Auth (JWT or API Key) ──────────────────────────────────────────

export function authenticateAny(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  const hasApiKey = !!req.headers['x-api-key'];

  if (hasBearer) return authenticate(req, res, next);
  if (hasApiKey) return authenticateApiKey(req, res, next);

  sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
}

// ─── RBAC Middleware ──────────────────────────────────────────────────────────

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    if (!roles.includes(req.user.role)) {
      sendError(res, 403, 'FORBIDDEN', `Required role: ${roles.join(' or ')}`);
      return;
    }
    next();
  };
}

export function requireMinRole(minRole: UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      sendError(res, 403, 'FORBIDDEN', `Insufficient permissions`);
      return;
    }
    next();
  };
}

// Convenience aliases
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
export const requireAdmin = requireMinRole(UserRole.PROGRAM_ADMIN);
export const requireFinance = requireMinRole(UserRole.FINANCE);
export const requireSupport = requireMinRole(UserRole.SUPPORT);
