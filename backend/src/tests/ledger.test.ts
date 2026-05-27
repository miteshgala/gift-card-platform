import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardStatus, LedgerEntryType, Prisma } from '@prisma/client';

// Mock prisma
const mockTx = {
  giftCard: { findUnique: vi.fn(), update: vi.fn() },
  ledgerEntry: { create: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock('../config/prisma', () => ({
  prisma: {
    $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    giftCard: { findUnique: vi.fn() },
    ledgerEntry: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import * as ledgerService from '../modules/ledger/ledger.service';
import { prisma } from '../config/prisma';

const makeCard = (overrides = {}) => ({
  id: 'card-1',
  status: CardStatus.ACTIVE,
  currentBalance: new Prisma.Decimal(100),
  currency: 'USD',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  ...overrides,
});

describe('Ledger Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.giftCard.findUnique.mockResolvedValue(makeCard());
    mockTx.giftCard.update.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue({
      id: 'entry-1',
      type: LedgerEntryType.LOAD,
      amount: new Prisma.Decimal(50),
      balanceBefore: new Prisma.Decimal(100),
      balanceAfter: new Prisma.Decimal(150),
    });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  // ─── Load ────────────────────────────────────────────────────────────────
  describe('loadCard', () => {
    it('creates a LOAD ledger entry', async () => {
      const entry = await ledgerService.loadCard({
        cardId: 'card-1',
        amount: 50,
        actorId: 'user-1',
      });
      expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: LedgerEntryType.LOAD }) })
      );
      expect(entry).toBeDefined();
    });

    it('throws NOT_FOUND for unknown card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(null);
      await expect(ledgerService.loadCard({ cardId: 'bad', amount: 10 })).rejects.toThrow('CARD_NOT_FOUND');
    });

    it('blocks loading a CANCELLED card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.CANCELLED }));
      await expect(ledgerService.loadCard({ cardId: 'card-1', amount: 10 })).rejects.toThrow();
    });

    it('blocks loading an expired card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ expiresAt: new Date('2000-01-01') }));
      await expect(ledgerService.loadCard({ cardId: 'card-1', amount: 10 })).rejects.toThrow('CARD_EXPIRED');
    });
  });

  // ─── Redeem ──────────────────────────────────────────────────────────────
  describe('redeemCard', () => {
    beforeEach(() => {
      mockTx.ledgerEntry.create.mockResolvedValue({
        id: 'entry-2',
        type: LedgerEntryType.REDEEM,
        amount: new Prisma.Decimal(30),
        balanceBefore: new Prisma.Decimal(100),
        balanceAfter: new Prisma.Decimal(70),
      });
    });

    it('deducts balance and returns remaining', async () => {
      const result = await ledgerService.redeemCard({ cardId: 'card-1', amount: 30 });
      expect(result.remainingBalance).toBe('70');
      expect(result.isFullyRedeemed).toBe(false);
    });

    it('marks card REDEEMED when balance hits zero', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ currentBalance: new Prisma.Decimal(30) }));
      mockTx.ledgerEntry.create.mockResolvedValue({
        id: 'entry-3',
        type: LedgerEntryType.REDEEM,
        amount: new Prisma.Decimal(30),
        balanceBefore: new Prisma.Decimal(30),
        balanceAfter: new Prisma.Decimal(0),
      });
      const result = await ledgerService.redeemCard({ cardId: 'card-1', amount: 30 });
      expect(result.isFullyRedeemed).toBe(true);
      expect(mockTx.giftCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: CardStatus.REDEEMED }) })
      );
    });

    it('throws INSUFFICIENT_BALANCE when amount exceeds balance', async () => {
      await expect(ledgerService.redeemCard({ cardId: 'card-1', amount: 999 })).rejects.toThrow('INSUFFICIENT_BALANCE');
    });

    it('throws CARD_FROZEN for frozen cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.FROZEN }));
      await expect(ledgerService.redeemCard({ cardId: 'card-1', amount: 10 })).rejects.toThrow('CARD_FROZEN');
    });

    it('throws CARD_EXPIRED for expired cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ expiresAt: new Date('2000-01-01') }));
      await expect(ledgerService.redeemCard({ cardId: 'card-1', amount: 10 })).rejects.toThrow('CARD_EXPIRED');
    });
  });

  // ─── Refund ──────────────────────────────────────────────────────────────
  describe('refundCard', () => {
    beforeEach(() => {
      mockTx.ledgerEntry.create.mockResolvedValue({
        id: 'entry-4',
        type: LedgerEntryType.REFUND,
        amount: new Prisma.Decimal(20),
        balanceBefore: new Prisma.Decimal(80),
        balanceAfter: new Prisma.Decimal(100),
      });
    });

    it('creates a REFUND ledger entry', async () => {
      const entry = await ledgerService.refundCard({ cardId: 'card-1', amount: 20 });
      expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: LedgerEntryType.REFUND }) })
      );
      expect(entry).toBeDefined();
    });

    it('reactivates a fully-redeemed card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.REDEEMED, currentBalance: new Prisma.Decimal(0) }));
      await ledgerService.refundCard({ cardId: 'card-1', amount: 20 });
      expect(mockTx.giftCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: CardStatus.ACTIVE }) })
      );
    });

    it('throws for CANCELLED card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.CANCELLED }));
      await expect(ledgerService.refundCard({ cardId: 'card-1', amount: 10 })).rejects.toThrow('CARD_CANCELLED');
    });
  });

  // ─── Adjustment ──────────────────────────────────────────────────────────
  describe('adjustCard', () => {
    beforeEach(() => {
      mockTx.ledgerEntry.create.mockResolvedValue({ id: 'entry-5', type: LedgerEntryType.ADJUSTMENT });
    });

    it('credits the card with positive amount', async () => {
      await ledgerService.adjustCard({ cardId: 'card-1', amount: 25, description: 'Promo credit', actorId: 'user-1' });
      expect(mockTx.giftCard.update).toHaveBeenCalled();
    });

    it('debits the card with negative amount', async () => {
      await ledgerService.adjustCard({ cardId: 'card-1', amount: -10, description: 'Fee', actorId: 'user-1' });
      expect(mockTx.giftCard.update).toHaveBeenCalled();
    });

    it('throws NEGATIVE_BALANCE if debit would go below zero', async () => {
      await expect(
        ledgerService.adjustCard({ cardId: 'card-1', amount: -200, description: 'Too much', actorId: 'user-1' })
      ).rejects.toThrow('NEGATIVE_BALANCE');
    });
  });
});
