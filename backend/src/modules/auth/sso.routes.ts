/**
 * SSO / OIDC Routes  (openid-client v6 API)
 *
 * Flow:
 *   1. GET  /api/v1/auth/sso/begin?programSlug=<slug>
 *      → redirects to the identity provider (Okta, Azure AD, Google, etc.)
 *   2. GET  /api/v1/auth/sso/callback?code=...&state=...
 *      → exchanges code, upserts user, returns standard JWT pair as JSON
 *
 * Program must have:
 *   ssoEnabled=true, ssoIssuerUrl, ssoClientId, ssoClientSecret, ssoRedirectUri
 */

import { Router, Request, Response } from 'express';
import * as oidc from 'openid-client';
import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { UserRole, AuditAction } from '@prisma/client';
import { generateSecureToken, hashToken, hashPassword } from '../../utils/crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { JwtPayload } from '../../types';

const router = Router();

// ─── In-memory state store ────────────────────────────────────────────────────
// Replace with Redis for multi-instance deployments.

interface SsoState {
  programId: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}

const stateStore = new Map<string, SsoState>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
}, 5 * 60 * 1000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signAccessToken(user: { id: string; email: string; role: UserRole; programId: string | null }): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    programId: user.programId ?? undefined,
  };
  return jwt.sign(payload as object, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

async function getOidcConfig(program: {
  ssoIssuerUrl: string;
  ssoClientId: string;
  ssoClientSecret: string;
}): Promise<oidc.Configuration> {
  return oidc.discovery(
    new URL(program.ssoIssuerUrl),
    program.ssoClientId,
    program.ssoClientSecret
  );
}

// ─── GET /begin ───────────────────────────────────────────────────────────────

router.get('/begin', async (req: Request, res: Response) => {
  const { programSlug } = req.query as { programSlug?: string };
  if (!programSlug) throw new AppError(400, 'MISSING_PARAM', 'programSlug is required');

  const program = await prisma.program.findUnique({
    where: { slug: programSlug },
    select: {
      id: true, ssoEnabled: true, ssoIssuerUrl: true,
      ssoClientId: true, ssoClientSecret: true, ssoRedirectUri: true,
    },
  });

  if (!program?.ssoEnabled) {
    throw new AppError(400, 'SSO_NOT_ENABLED', 'SSO is not enabled for this program');
  }
  if (!program.ssoIssuerUrl || !program.ssoClientId || !program.ssoClientSecret || !program.ssoRedirectUri) {
    throw new AppError(500, 'SSO_MISCONFIGURED', 'SSO configuration is incomplete for this program');
  }

  const config = await getOidcConfig(program as {
    ssoIssuerUrl: string; ssoClientId: string; ssoClientSecret: string;
  });

  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  stateStore.set(state, {
    programId: program.id,
    codeVerifier,
    nonce,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: program.ssoRedirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  logger.info('SSO flow initiated', { programId: program.id });
  res.redirect(authUrl.href);
});

// ─── GET /callback ────────────────────────────────────────────────────────────

router.get('/callback', async (req: Request, res: Response) => {
  const { state, error, error_description } = req.query as Record<string, string>;

  if (error) {
    logger.warn('SSO callback error', { error, error_description });
    throw new AppError(401, 'SSO_ERROR', error_description ?? error);
  }
  if (!state) throw new AppError(400, 'INVALID_CALLBACK', 'Missing state parameter');

  const stored = stateStore.get(state);
  if (!stored || stored.expiresAt < Date.now()) {
    throw new AppError(400, 'INVALID_STATE', 'SSO state is invalid or expired. Please try again.');
  }
  stateStore.delete(state);

  const program = await prisma.program.findUnique({
    where: { id: stored.programId },
    select: { id: true, ssoIssuerUrl: true, ssoClientId: true, ssoClientSecret: true, ssoRedirectUri: true },
  });

  if (!program?.ssoIssuerUrl || !program.ssoClientId || !program.ssoClientSecret || !program.ssoRedirectUri) {
    throw new AppError(500, 'SSO_MISCONFIGURED', 'SSO configuration is incomplete');
  }

  const config = await getOidcConfig(program as {
    ssoIssuerUrl: string; ssoClientId: string; ssoClientSecret: string;
  });

  // Build a Request-like object that openid-client v6 expects
  const callbackUrl = new URL(`${program.ssoRedirectUri}?${new URLSearchParams(req.query as Record<string, string>).toString()}`);

  const tokenSet = await oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: stored.codeVerifier,
    expectedNonce: stored.nonce,
    expectedState: state,
  });

  const claims = (tokenSet.claims() ?? {}) as Record<string, unknown>;
  const email = claims['email'] as string | undefined;
  if (!email) throw new AppError(401, 'SSO_NO_EMAIL', 'Identity provider did not return an email');

  const firstName = ((claims['given_name'] ?? '') as string) || email.split('@')[0];
  const lastName = ((claims['family_name'] ?? '') as string);

  // Upsert the user
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const dummyPasswordHash = await hashPassword(generateSecureToken(32));
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: dummyPasswordHash,
        firstName,
        lastName,
        role: UserRole.READ_ONLY,
        programId: stored.programId,
        emailVerified: true,
      },
    });
    logger.info('SSO: new user provisioned', { userId: user.id, email });
  } else if (!user.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'Your account has been disabled');
  }

  // Issue standard JWT pair
  const accessToken = signAccessToken(user);
  const refreshRaw = generateSecureToken(48);
  const refreshHash = hashToken(refreshRaw);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        action: AuditAction.USER_LOGIN,
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: req.ip,
        programId: stored.programId,
        diff: { method: 'sso' },
      },
    }),
  ]);

  logger.info('SSO login successful', { userId: user.id, email });

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: refreshRaw,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        programId: user.programId,
      },
    },
  });
});

export default router;
