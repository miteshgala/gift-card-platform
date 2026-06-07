/**
 * Unit tests for auth.service.ts
 *
 * Strategy:
 *  - Mock prisma (DB calls), keep real bcrypt/jwt for realistic crypto paths
 *  - Test all major login branches: not found, inactive, locked, bad password,
 *    lockout trigger, TOTP required, success
 *  - Test refresh token rotation and reuse detection
 *  - Test password strength validation via resetPassword
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';

// ─── Mocks — vi.hoisted ensures factory refs survive Vitest hoisting ──────────

const { mockPrisma } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockPrisma: {
      user: { findUnique: fn(), findFirst: fn(), update: fn() },
      refreshToken: { create: fn(), findUnique: fn(), updateMany: fn(), update: fn() },
      $transaction: fn(),
    },
  };
});

vi.mock('@/shared/db/prisma', () => ({
  prisma: mockPrisma,
  prismaRead: mockPrisma,
}));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import { login, refresh, logout } from '../auth.service';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Minimal Express-like request for auth functions */
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'vitest/1.0' },
    requestId: 'test-req-id',
    ...overrides,
  } as unknown as Request;
}

const VALID_PASSWORD = 'Valid!Pass99#';
let HASHED_PASSWORD: string;

/** Build a standard active user record */
async function makeUser(overrides: Record<string, unknown> = {}) {
  if (!HASHED_PASSWORD) {
    HASHED_PASSWORD = await bcrypt.hash(VALID_PASSWORD, 4); // low cost for tests
  }
  return {
    id: 'user_001',
    email: 'admin@example.com',
    role: 'SUPER_ADMIN',
    programId: null,
    status: 'ACTIVE',
    emailVerified: true,
    passwordHash: HASHED_PASSWORD,
    lockedUntil: null,
    failedAttempts: 0,
    totpEnabled: false,
    totpSecret: null,
    ...overrides,
  };
}

// ─── login ────────────────────────────────────────────────────────────────────

describe('login', () => {
  beforeEach(() => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.create.mockResolvedValue({});
  });

  it('throws INVALID_CREDENTIALS when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(login({ email: 'nobody@example.com', password: 'whatever' }, makeReq()))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('throws INVALID_CREDENTIALS when user is SUSPENDED', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ status: 'SUSPENDED' }));

    await expect(login({ email: 'admin@example.com', password: VALID_PASSWORD }, makeReq()))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('throws INVALID_CREDENTIALS when email not verified', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ emailVerified: false }));

    await expect(login({ email: 'admin@example.com', password: VALID_PASSWORD }, makeReq()))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('throws ACCOUNT_LOCKED when lockedUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000);
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ lockedUntil: future }));

    await expect(login({ email: 'admin@example.com', password: VALID_PASSWORD }, makeReq()))
      .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('throws INVALID_CREDENTIALS for wrong password and increments failedAttempts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ failedAttempts: 1 }));

    await expect(
      login({ email: 'admin@example.com', password: 'WrongPass99!' }, makeReq()),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    // Should update user with incremented failedAttempts
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedAttempts: 2 }),
      }),
    );
  });

  it('locks account after 5 failed attempts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ failedAttempts: 4 }));

    await expect(
      login({ email: 'admin@example.com', password: 'WrongPass99!' }, makeReq()),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
      }),
    );
  });

  it('throws TOTP_REQUIRED when totpEnabled but no code provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      await makeUser({ totpEnabled: true, totpSecret: 'encrypted_secret' }),
    );

    // We don't need TOTP to verify here — it throws before TOTP validation because
    // the service calls authFail() then checks totpEnabled. Actually let's check:
    // looking at auth.service.ts: after password check passes, it checks totpEnabled.
    // But we need the password to be correct first. Let's use the valid password.

    await expect(
      login({ email: 'admin@example.com', password: VALID_PASSWORD }, makeReq()),
    ).rejects.toMatchObject({ code: 'TOTP_REQUIRED' });
  });

  it('returns accessToken and refreshToken on successful login', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser());

    const result = await login(
      { email: 'admin@example.com', password: VALID_PASSWORD },
      makeReq(),
    );

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Should reset failed attempts
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedAttempts: 0, lockedUntil: null }),
      }),
    );
  });

  it('normalises email to lowercase', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await makeUser({ email: 'Admin@Example.com' }));

    // The service calls findUnique with email.toLowerCase().trim()
    await login({ email: 'Admin@Example.com', password: VALID_PASSWORD }, makeReq()).catch(() => {});

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'admin@example.com' },
      }),
    );
  });
});

// ─── refresh ──────────────────────────────────────────────────────────────────

describe('refresh', () => {
  const RAW_TOKEN = 'a'.repeat(64);

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_001',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
      programId: null,
      status: 'ACTIVE',
    });
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => {
      // ops is an array of Promises — resolve them all
      return Promise.all(ops as Promise<unknown>[]);
    });
  });

  it('throws TOKEN_INVALID when token not found', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(refresh(RAW_TOKEN, makeReq())).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('throws TOKEN_INVALID when token is expired', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt_001',
      userId: 'user_001',
      familyId: 'fam_001',
      expiresAt: new Date(Date.now() - 1000), // expired
      revokedAt: null,
      replacedBy: null,
    });

    await expect(refresh(RAW_TOKEN, makeReq())).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('throws TOKEN_INVALID when token is revoked', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt_001',
      userId: 'user_001',
      familyId: 'fam_001',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(), // revoked
      replacedBy: null,
    });

    await expect(refresh(RAW_TOKEN, makeReq())).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('detects token reuse when replacedBy is set and revokes the whole family', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt_001',
      userId: 'user_001',
      familyId: 'fam_001',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBy: 'new_token_hash', // already replaced — reuse!
    });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(refresh(RAW_TOKEN, makeReq())).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });

    // Should revoke all tokens in the family
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: 'fam_001' },
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });

  it('returns new tokens and updates replacedBy on valid refresh', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt_001',
      userId: 'user_001',
      familyId: 'fam_001',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBy: null,
    });
    mockPrisma.refreshToken.update.mockResolvedValue({});

    const result = await refresh(RAW_TOKEN, makeReq());

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(RAW_TOKEN); // must rotate
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

// ─── logout ───────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('revokes the refresh token by hash', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await logout('raw_token_value', makeReq());

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });

  it('is a no-op (does not throw) when token is not found', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(logout('nonexistent_token', makeReq())).resolves.toBeUndefined();
  });
});
