import jwt from 'jsonwebtoken';
import { User, UserRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  generateSecureToken,
} from '../../utils/crypto';
import { JwtPayload } from '../../types';
import { AuditAction } from '@prisma/client';

// ─── Token Generation ─────────────────────────────────────────────────────────

function signAccessToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    programId: user.programId ?? undefined,
  };
  return jwt.sign(payload as object, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as never });
}

function signRefreshToken(): string {
  return generateSecureToken(48);
}

// ─── Audit Helper ─────────────────────────────────────────────────────────────

async function audit(
  action: AuditAction,
  actorId: string | null,
  actorEmail: string | null,
  resourceId?: string,
  ipAddress?: string,
  programId?: string
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorEmail,
      action,
      resourceType: 'User',
      resourceId,
      ipAddress,
      programId,
    },
  });
}

// ─── Service Methods ──────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  programId?: string;
}

export async function registerUser(input: RegisterInput, ipAddress?: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError(409, 'EMAIL_EXISTS', 'Email already registered');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? UserRole.READ_ONLY,
      programId: input.programId,
    },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, programId: true, createdAt: true,
    },
  });

  await audit(AuditAction.USER_REGISTER, user.id, user.email, user.id, ipAddress, input.programId);
  logger.info('User registered', { userId: user.id, email: user.email });
  return user;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.isActive) {
    await audit(AuditAction.USER_LOGIN_FAILED, null, input.email, undefined, input.ipAddress);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    await audit(AuditAction.USER_LOGIN_FAILED, user.id, user.email, user.id, input.ipAddress);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // Issue tokens
  const accessToken = signAccessToken(user);
  const refreshTokenRaw = signRefreshToken();
  const tokenHash = hashToken(refreshTokenRaw);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  await audit(AuditAction.USER_LOGIN, user.id, user.email, user.id, input.ipAddress, user.programId ?? undefined);

  return {
    accessToken,
    refreshToken: refreshTokenRaw,
    expiresIn: 900, // 15 min in seconds
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      programId: user.programId,
    },
  };
}

export async function refreshTokens(
  refreshTokenRaw: string,
  userAgent?: string,
  ipAddress?: string
) {
  const tokenHash = hashToken(refreshTokenRaw);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError(401, 'INVALID_TOKEN', 'Refresh token is invalid or expired');
  }

  if (!stored.user.isActive) {
    throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is disabled');
  }

  // Rotate: revoke old, issue new
  const newAccessToken = signAccessToken(stored.user);
  const newRefreshRaw = signRefreshToken();
  const newTokenHash = hashToken(newRefreshRaw);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: stored.user.id,
        tokenHash: newTokenHash,
        expiresAt,
        userAgent,
        ipAddress,
      },
    }),
  ]);

  await audit(AuditAction.TOKEN_REFRESH, stored.user.id, stored.user.email, stored.user.id, ipAddress);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshRaw,
    expiresIn: 900,
  };
}

export async function logoutUser(refreshTokenRaw: string, userId: string, ipAddress?: string) {
  const tokenHash = hashToken(refreshTokenRaw);

  await prisma.refreshToken.updateMany({
    where: { tokenHash, userId },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, programId: true } });
  await audit(AuditAction.USER_LOGOUT, userId, user?.email ?? null, userId, ipAddress, user?.programId ?? undefined);
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired');
  }
}
