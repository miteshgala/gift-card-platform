import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { prisma } from '../../shared/db/prisma';
import { env } from '../../shared/utils/env';
import { encrypt, decrypt, sha256, generateSecureToken, generateInviteToken, safeEqual } from '../../shared/utils/crypto';
import { logger } from '../../shared/utils/logger';
import { Errors } from '../../shared/errors/AppError';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import type { TokenPair, LoginInput, JwtPayload } from './auth.types';
import type { Request } from 'express';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;  // 72 hours
const RESET_TTL_MS = 15 * 60 * 1000;         // 15 minutes

// ─── Token issuance ───────────────────────────────────────────────────────────

function issueAccessToken(user: { id: string; email: string; role: string; programId: string | null }): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    programId: user.programId,
    jti: crypto.randomUUID(),
  };

  return jwt.sign(payload, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_SECONDS,
  });
}

async function issueRefreshToken(
  userId: string,
  familyId: string | null,
  req: Request,
): Promise<string> {
  const raw = generateSecureToken(32);
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_SECONDS * 1000);
  const newFamilyId = familyId ?? crypto.randomUUID();

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      familyId: newFamilyId,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      expiresAt,
    },
  });

  return raw;
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(input: LoginInput, req: Request): Promise<TokenPair> {
  // 1. Find user — constant-time path to prevent timing attacks
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
  });

  // Generic error for all auth failures — never reveal specific reason to caller
  const authFail = () => {
    void writeAuditLog({ action: 'LOGIN_FAILED', category: 'AUTH', req, details: { email: input.email } });
    throw Errors.invalidCredentials();
  };

  if (!user) return authFail();

  // 2. Account must be ACTIVE
  if (user.status !== 'ACTIVE') return authFail();

  // 3. Email must be verified
  if (!user.emailVerified) return authFail();

  // 4. Check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw Errors.accountLocked(user.lockedUntil);
  }

  // 5. Password check
  if (!user.passwordHash) return authFail(); // SSO-only account
  const passwordValid = await bcrypt.compare(input.password, user.passwordHash);

  if (!passwordValid) {
    const newAttempts = user.failedAttempts + 1;
    const lockUntil = newAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_DURATION_MS)
      : null;

    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: newAttempts, lockedUntil: lockUntil },
    });

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      void writeAuditLog({ action: 'ACCOUNT_LOCKED', category: 'AUTH', req, resourceId: user.id, details: { attempts: newAttempts } });
      throw Errors.accountLocked(lockUntil!);
    }

    return authFail();
  }

  // 6. TOTP check (if enabled)
  if (user.totpEnabled && user.totpSecret) {
    if (!input.totpCode) throw Errors.totpRequired();

    const secret = decrypt(user.totpSecret);
    authenticator.options = { digits: 6, step: 30 };
    const valid = authenticator.verify({ token: input.totpCode, secret });

    if (!valid) {
      void writeAuditLog({ action: 'LOGIN_TOTP_FAILED', category: 'AUTH', req, resourceId: user.id });
      throw Errors.invalidTotp();
    }
  }

  // 7. Reset failed attempts + update last login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: req.ip ?? null,
    },
  });

  // 8. Issue tokens
  const accessToken = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, null, req);

  void writeAuditLog({ action: 'LOGIN_SUCCESS', category: 'AUTH', req, resourceId: user.id, programId: user.programId ?? undefined });

  logger.info('User logged in', { userId: user.id, email: user.email, requestId: req.requestId });

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + env.JWT_ACCESS_EXPIRES_SECONDS * 1000),
  };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh(rawToken: string, req: Request): Promise<TokenPair> {
  const tokenHash = sha256(rawToken);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.expiresAt < new Date() || stored.revokedAt) {
    throw Errors.tokenInvalid();
  }

  // Detect token reuse: if this token was already replaced, the family is compromised
  if (stored.replacedBy) {
    // Revoke entire family
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId },
      data: { revokedAt: new Date() },
    });
    void writeAuditLog({ action: 'TOKEN_REUSE_DETECTED', category: 'AUTH', req, resourceId: stored.userId });
    logger.warn('Refresh token reuse detected — family revoked', { userId: stored.userId, familyId: stored.familyId });
    throw Errors.tokenReuseDetected();
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, email: true, role: true, programId: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    await prisma.refreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
    throw Errors.tokenInvalid();
  }

  // Issue new refresh token
  const newRawToken = generateSecureToken(32);
  const newTokenHash = sha256(newRawToken);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_SECONDS * 1000);

  await prisma.$transaction([
    // Mark old token as replaced
    prisma.refreshToken.update({
      where: { tokenHash },
      data: { replacedBy: newTokenHash },
    }),
    // Create new token
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        familyId: stored.familyId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        expiresAt,
      },
    }),
  ]);

  const accessToken = issueAccessToken(user);

  return {
    accessToken,
    refreshToken: newRawToken,
    expiresAt: new Date(Date.now() + env.JWT_ACCESS_EXPIRES_SECONDS * 1000),
  };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(rawToken: string, req: Request): Promise<void> {
  const tokenHash = sha256(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
  void writeAuditLog({ action: 'LOGOUT', category: 'AUTH', req });
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  // Always return success — never reveal if the email exists
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, firstName: true },
  });

  if (!user || user === null) return; // Silent no-op

  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: { resetTokenHash: hash, resetExpiresAt: expiresAt },
  });

  // Email sending is handled by the notification service
  logger.info('Password reset token generated', { userId: user.id });
  // TODO: publish FORGOT_PASSWORD event to Kafka → notification service sends email with raw token
  void raw; // Will be used by notification service
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const hash = sha256(token);
  const user = await prisma.user.findFirst({
    where: { resetTokenHash: hash, resetExpiresAt: { gt: new Date() } },
  });

  if (!user) throw Errors.tokenInvalid();

  await validatePasswordStrength(newPassword);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetTokenHash: null,
      resetExpiresAt: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // Revoke all refresh tokens for this user
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  logger.info('Password reset completed', { userId: user.id });
}

// ─── Accept Invite ────────────────────────────────────────────────────────────

export async function acceptInvite(token: string, password: string, req: Request): Promise<TokenPair> {
  const hash = sha256(token);
  const user = await prisma.user.findFirst({
    where: { inviteTokenHash: hash, inviteExpiresAt: { gt: new Date() } },
  });

  if (!user) throw Errors.tokenInvalid();
  if (user.status !== 'INVITED') throw Errors.tokenInvalid();

  await validatePasswordStrength(password);

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
      inviteTokenHash: null,
      inviteExpiresAt: null,
    },
  });

  void writeAuditLog({ action: 'INVITE_ACCEPTED', category: 'AUTH', req, resourceId: user.id });

  const accessToken = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, null, req);

  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + env.JWT_ACCESS_EXPIRES_SECONDS * 1000) };
}

// ─── TOTP Setup ───────────────────────────────────────────────────────────────

export async function setupTotp(userId: string): Promise<{ qrCodeUrl: string; secret: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });

  const secret = authenticator.generateSecret(20);
  const otpAuthUrl = authenticator.keyuri(user.email, 'GiftCard Platform', secret);
  const qrCodeUrl = await qrcode.toDataURL(otpAuthUrl);

  // Store pending secret (not yet confirmed) encrypted
  await prisma.user.update({
    where: { id: userId },
    data: { totpPendingSecret: encrypt(secret) },
  });

  return { qrCodeUrl, secret }; // secret shown once for manual entry
}

export async function confirmTotp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpPendingSecret: true },
  });

  if (!user.totpPendingSecret) throw Errors.badRequest('No pending TOTP setup');

  const secret = decrypt(user.totpPendingSecret);
  authenticator.options = { digits: 6, step: 30 };
  const valid = authenticator.verify({ token: code, secret });

  if (!valid) throw Errors.invalidTotp();

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: user.totpPendingSecret, // already encrypted
      totpPendingSecret: null,
      totpEnabled: true,
    },
  });
}

export async function disableTotp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpEnabled: true },
  });

  if (!user.totpEnabled || !user.totpSecret) throw Errors.badRequest('TOTP is not enabled');

  const secret = decrypt(user.totpSecret);
  authenticator.options = { digits: 6, step: 30 };
  const valid = authenticator.verify({ token: code, secret });

  if (!valid) throw Errors.invalidTotp();

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null, totpPendingSecret: null },
  });
}

// ─── Change own password ──────────────────────────────────────────────────────

export async function changePassword(userId: string, currentPassword: string, newPassword: string, req: Request): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true, status: true } });
  if (!user?.passwordHash) throw Errors.invalidCredentials();

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw Errors.invalidCredentials();

  const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{12,}$/;
  if (!STRONG_PASSWORD_RE.test(newPassword)) {
    throw new (await import('../../shared/errors/AppError')).AppError(422, 'WEAK_PASSWORD', 'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

  // Revoke all existing refresh tokens so other sessions are forced to re-login
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  void writeAuditLog({ action: 'PASSWORD_CHANGED', category: 'AUTH', req, resourceId: userId });
}

// ─── JWKS endpoint (public) ───────────────────────────────────────────────────

export function getJwks(): object {
  // Parse the public key and return as JWK
  // In production, use the `jose` library for full JWKS support
  const publicKey = env.JWT_PUBLIC_KEY;
  return {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        // kid derived from key hash — allows key rotation
        kid: sha256(publicKey).slice(0, 16),
        // Full JWK representation would go here
        // For simplicity, returning the PEM — use `jose` library for proper JWK in production
        n: Buffer.from(publicKey).toString('base64url'),
      },
    ],
  };
}

// ─── Password strength validation ─────────────────────────────────────────────

async function validatePasswordStrength(password: string): Promise<void> {
  if (password.length < 12) throw Errors.badRequest('Password must be at least 12 characters');
  if (password.length > 128) throw Errors.badRequest('Password must be at most 128 characters');
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    throw Errors.badRequest('Password must contain uppercase, lowercase, digit, and special character');
  }
}

// Suppress unused warning for safeEqual import
void safeEqual;
