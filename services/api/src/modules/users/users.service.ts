/**
 * Users Service
 * User management: invite, list, update role, suspend, deactivate.
 * Password resets and invite acceptance handled in auth.service.
 */

import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { generateInviteToken } from '../../shared/utils/crypto';
import { logger } from '../../shared/utils/logger';

const INVITE_EXPIRY_HOURS = 72;

export interface InviteUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  programId?: string;
  invitedBy: string;
}

const VALID_ROLES = ['SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT', 'AUDITOR', 'API_SERVICE'];
const PROGRAM_SCOPED_ROLES = ['PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT', 'AUDITOR'];

export async function inviteUser(input: InviteUserInput) {
  if (!VALID_ROLES.includes(input.role)) {
    throw new AppError(400, 'INVALID_ROLE', `Invalid role: ${input.role}`);
  }
  if (PROGRAM_SCOPED_ROLES.includes(input.role) && !input.programId) {
    throw new AppError(400, 'PROGRAM_REQUIRED', `Role ${input.role} requires a programId`);
  }

  const existing = await prismaRead.user.findUnique({ where: { email: input.email }, select: { id: true, status: true } });
  if (existing && existing.status !== 'DEACTIVATED') {
    throw new AppError(409, 'EMAIL_IN_USE', 'A user with this email already exists');
  }

  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 3600 * 1000);

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          programId: input.programId ?? null,
          status: 'INVITED',
          emailVerified: false,
          inviteTokenHash: hash,
          inviteExpiresAt: expiresAt,
        },
      })
    : await prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          programId: input.programId ?? null,
          status: 'INVITED',
          inviteTokenHash: hash,
          inviteExpiresAt: expiresAt,
        },
      });

  // In production: send invite email via notification service
  logger.info('User invite generated', { userId: user.id, email: user.email, expiresAt });

  return { userId: user.id, email: user.email, inviteToken: raw, expiresAt };
}

export async function listUsers(opts: { programId?: string; role?: string; status?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const items = await prismaRead.user.findMany({
    where: {
      programId: opts.programId ?? undefined,
      role: opts.role ?? undefined,
      status: opts.status ?? undefined,
    },
    take: limit + 1,
    cursor: opts.cursor ? { id: opts.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true,
      programId: true, status: true, emailVerified: true, lastLoginAt: true,
      createdAt: true,
    },
  });
  const hasMore = items.length > limit;
  return { items: hasMore ? items.slice(0, limit) : items, hasMore, nextCursor: hasMore ? items[limit - 1]?.id : undefined };
}

export async function getUser(id: string) {
  const user = await prismaRead.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true,
      programId: true, status: true, emailVerified: true, totpEnabled: true,
      lastLoginAt: true, lastLoginIp: true, failedAttempts: true, createdAt: true,
    },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

export async function updateUserRole(id: string, role: string, programId?: string | null) {
  if (!VALID_ROLES.includes(role)) throw new AppError(400, 'INVALID_ROLE', `Invalid role: ${role}`);
  if (PROGRAM_SCOPED_ROLES.includes(role) && !programId) {
    throw new AppError(400, 'PROGRAM_REQUIRED', `Role ${role} requires a programId`);
  }
  await getUser(id);
  return prisma.user.update({
    where: { id },
    data: { role, programId: programId ?? null },
  });
}

export async function suspendUser(id: string) {
  await getUser(id);
  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function activateUser(id: string) {
  await getUser(id);
  return prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
}

export async function deactivateUser(id: string) {
  await getUser(id);
  await prisma.user.update({ where: { id }, data: { status: 'DEACTIVATED' } });
  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listApiKeys(userId: string, programId: string) {
  return prismaRead.apiKey.findMany({
    where: { programId, revokedAt: null },
    select: { id: true, name: true, keyPrefix: true, environment: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeApiKey(keyId: string, programId?: string) {
  const key = await prismaRead.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new AppError(404, 'NOT_FOUND', 'API key not found');
  if (programId && key.programId !== programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  return prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
}
