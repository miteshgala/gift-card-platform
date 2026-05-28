import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Match AppError by its machine-readable code field */
const codeOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e: unknown) { return (e as { code?: string }).code; }
};
import { FraudSeverity } from '@prisma/client';

vi.mock('../config/prisma', () => ({
  prisma: {
    velocityRule: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    giftCard: { findUnique: vi.fn() },
    ledgerEntry: { aggregate: vi.fn() },
    fraudFlag: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import * as fraudService from '../modules/fraud/fraud.service';
import { prisma } from '../config/prisma';

describe('Fraud Service', () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Velocity Checks ──────────────────────────────────────────────────────
  describe('checkVelocity', () => {
    it('returns allowed=true when no rules exist', async () => {
      (prisma.velocityRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await fraudService.checkVelocity({
        cardId: 'card-1',
        programId: 'prog-1',
        amount: 100,
      });
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('detects amount-based velocity violation', async () => {
      (prisma.velocityRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'rule-1',
          name: 'Hourly limit',
          windowSeconds: 3600,
          maxAmount: 200,
          maxCount: null,
          scope: 'card',
          programId: 'prog-1',
        },
      ]);
      (prisma.ledgerEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { amount: 180 },
        _count: { id: 2 },
      });

      const result = await fraudService.checkVelocity({
        cardId: 'card-1',
        programId: 'prog-1',
        amount: 50, // 180 + 50 = 230 > 200
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.flags[0].severity).toBe(FraudSeverity.HIGH);
    });

    it('detects count-based velocity violation', async () => {
      (prisma.velocityRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'rule-2',
          name: 'Daily count',
          windowSeconds: 86400,
          maxAmount: null,
          maxCount: 5,
          scope: 'card',
          programId: 'prog-1',
        },
      ]);
      (prisma.ledgerEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { amount: 100 },
        _count: { id: 5 }, // 5 + 1 = 6 > 5
      });

      const result = await fraudService.checkVelocity({
        cardId: 'card-1',
        programId: 'prog-1',
        amount: 10,
      });

      expect(result.allowed).toBe(false);
      expect(result.flags[0].severity).toBe(FraudSeverity.MEDIUM);
    });

    it('allows transaction within limits', async () => {
      (prisma.velocityRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'rule-3',
          name: 'Safe limit',
          windowSeconds: 3600,
          maxAmount: 1000,
          maxCount: 20,
          scope: 'card',
          programId: 'prog-1',
        },
      ]);
      (prisma.ledgerEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { amount: 50 },
        _count: { id: 2 },
      });

      const result = await fraudService.checkVelocity({
        cardId: 'card-1',
        programId: 'prog-1',
        amount: 100,
      });

      expect(result.allowed).toBe(true);
    });
  });

  // ─── Geolocation ─────────────────────────────────────────────────────────
  describe('checkGeolocation', () => {
    it('returns not suspicious when no prior location', async () => {
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        lastLocation: null,
        lastTransactionAt: null,
      });
      const result = await fraudService.checkGeolocation('card-1', 'New York, US');
      expect(result.suspicious).toBe(false);
    });

    it('flags rapid country change', async () => {
      const recentTx = new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        lastLocation: 'London, UK',
        lastTransactionAt: recentTx,
      });
      const result = await fraudService.checkGeolocation('card-1', 'Tokyo, JP');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Rapid location change');
    });

    it('does not flag same country', async () => {
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        lastLocation: 'New York, US',
        lastTransactionAt: new Date(),
      });
      const result = await fraudService.checkGeolocation('card-1', 'Los Angeles, US');
      expect(result.suspicious).toBe(false);
    });

    it('does not flag old country change', async () => {
      const oldTx = new Date(Date.now() - 48 * 3600 * 1000); // 48 hours ago
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        lastLocation: 'London, UK',
        lastTransactionAt: oldTx,
      });
      const result = await fraudService.checkGeolocation('card-1', 'Tokyo, JP');
      expect(result.suspicious).toBe(false);
    });
  });

  // ─── Fraud Flags CRUD ─────────────────────────────────────────────────────
  describe('createFraudFlag', () => {
    it('creates a fraud flag', async () => {
      const mockFlag = { id: 'flag-1', cardId: 'card-1', reason: 'Suspicious', severity: FraudSeverity.HIGH };
      (prisma.fraudFlag.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockFlag);

      const flag = await fraudService.createFraudFlag({
        cardId: 'card-1',
        reason: 'Suspicious',
        severity: FraudSeverity.HIGH,
      });

      expect(flag).toEqual(mockFlag);
      expect(prisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cardId: 'card-1', severity: FraudSeverity.HIGH }) })
      );
    });
  });

  describe('resolveFraudFlag', () => {
    it('resolves an existing flag', async () => {
      const flag = { id: 'flag-1', resolvedAt: null };
      (prisma.fraudFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(flag);
      (prisma.fraudFlag.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...flag, resolvedAt: new Date() });

      const result = await fraudService.resolveFraudFlag('flag-1', 'False positive', 'user-1');
      expect(result.resolvedAt).toBeDefined();
    });

    it('throws FLAG_NOT_FOUND for missing flag', async () => {
      (prisma.fraudFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await codeOf(() => fraudService.resolveFraudFlag('bad-id', 'reason', 'user-1'))).toBe('FLAG_NOT_FOUND');
    });

    it('throws ALREADY_RESOLVED for an already-resolved flag', async () => {
      (prisma.fraudFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'flag-1',
        resolvedAt: new Date(),
      });
      expect(await codeOf(() => fraudService.resolveFraudFlag('flag-1', 'reason', 'user-1'))).toBe('ALREADY_RESOLVED');
    });
  });
});
