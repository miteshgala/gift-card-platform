import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardStatus, LedgerEntryType, Prisma } from '@prisma/client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// Mock FX utility
vi.mock('../utils/fx', () => ({
  convertAmount: vi.fn().mockResolvedValue({ convertedAmount: 92, rate: 0.92, source: 'live' }),
}));

// Mock webhook dispatch (fire-and-forget, don't let it blow up tests)
vi.mock('../modules/webhooks/webhooks.service', () => ({
  dispatchWebhook: vi.fn().mockResolvedValue(undefined),
}));

import * as ledgerService from '../modules/ledger/ledger.service';
import { prisma } from '../config/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Match AppError by its machine-readable code field */
const codeOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e: unknown) { return (e as { code?: string }).code; }
};

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: 'card-1',
  status: CardStatus.ACTIVE,
  currentBalance: new Prisma.Decimal(100),
  currency: 'USD',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  programId: 'prog-1',
  campaignId: null,
  campaign: null,
  program: { metadata: null },
  ...overrides,
});

const makeEntry = (type: LedgerEntryType, amount: number, before: number, after: number) => ({
  id: `entry-${Math.random()}`,
  type,
  amount: new Prisma.Decimal(amount),
  balanceBefore: new Prisma.Decimal(before),
  balanceAfter: new Prisma.Decimal(after),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Ledger Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.giftCard.findUnique.mockResolvedValue(makeCard());
    mockTx.giftCard.update.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue(makeEntry(LedgerEntryType.LOAD, 50, 100, 150));
    mockTx.auditLog.create.mockResolvedValue({});
  });

  // ─── loadCard ─────────────────────────────────────────────────────────────

  describe('loadCard', () => {
    it('creates a LOAD ledger entry', async () => {
      const entry = await ledgerService.loadCard({ cardId: 'card-1', amount: 50, actorId: 'user-1' });
      expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: LedgerEntryType.LOAD }) })
      );
      expect(entry).toBeDefined();
    });

    it('sets balanceAfter = balanceBefore + amount', async () => {
      await ledgerService.loadCard({ cardId: 'card-1', amount: 50 });
      const call = mockTx.ledgerEntry.create.mock.calls[0][0];
      expect(call.data.balanceAfter.toString()).toBe('150');
    });

    it('throws CARD_NOT_FOUND for unknown card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(null);
      expect(await codeOf(() => ledgerService.loadCard({ cardId: 'bad', amount: 10 }))).toBe('CARD_NOT_FOUND');
    });

    it('throws CARD_EXPIRED for past expiry date', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ expiresAt: new Date('2000-01-01') }));
      expect(await codeOf(() => ledgerService.loadCard({ cardId: 'card-1', amount: 10 }))).toBe('CARD_EXPIRED');
    });

    it('blocks loading a CANCELLED card', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.CANCELLED }));
      const code = await codeOf(() => ledgerService.loadCard({ cardId: 'card-1', amount: 10 }));
      expect(code).toBeDefined(); // CARD_CANCELLED or similar
    });

    it('converts amount via FX when fundingCurrency differs from card currency', async () => {
      const { convertAmount } = await import('../utils/fx');
      await ledgerService.loadCard({ cardId: 'card-1', amount: 100, fundingCurrency: 'EUR' });
      expect(convertAmount).toHaveBeenCalledWith(100, 'EUR', 'USD');
      // creditAmount should be 92 (the mock converted value)
      const call = mockTx.ledgerEntry.create.mock.calls[0][0];
      expect(Number(call.data.amount)).toBe(92);
    });

    it('skips FX when fundingCurrency matches card currency', async () => {
      const { convertAmount } = await import('../utils/fx');
      vi.clearAllMocks();
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard());
      mockTx.giftCard.update.mockResolvedValue({});
      mockTx.ledgerEntry.create.mockResolvedValue(makeEntry(LedgerEntryType.LOAD, 50, 100, 150));
      await ledgerService.loadCard({ cardId: 'card-1', amount: 50, fundingCurrency: 'USD' });
      expect(convertAmount).not.toHaveBeenCalled();
    });

    it('stores FX metadata in ledger entry when conversion applied', async () => {
      await ledgerService.loadCard({ cardId: 'card-1', amount: 100, fundingCurrency: 'EUR' });
      const call = mockTx.ledgerEntry.create.mock.calls[0][0];
      expect(call.data.metadata).toMatchObject({
        fundingCurrency: 'EUR',
        fundingAmount: 100,
        fxRate: 0.92,
      });
    });
  });

  // ─── redeemCard ───────────────────────────────────────────────────────────

  describe('redeemCard', () => {
    beforeEach(() => {
      mockTx.ledgerEntry.create.mockResolvedValue(makeEntry(LedgerEntryType.REDEEM, 30, 100, 70));
    });

    it('deducts balance and returns remaining', async () => {
      const result = await ledgerService.redeemCard({ cardId: 'card-1', amount: 30 });
      expect(result.remainingBalance).toBe('70');
      expect(result.isFullyRedeemed).toBe(false);
    });

    it('marks card REDEEMED when balance hits zero', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ currentBalance: new Prisma.Decimal(30) }));
      mockTx.ledgerEntry.create.mockResolvedValue(makeEntry(LedgerEntryType.REDEEM, 30, 30, 0));
      const result = await ledgerService.redeemCard({ cardId: 'card-1', amount: 30 });
      expect(result.isFullyRedeemed).toBe(true);
      expect(mockTx.giftCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: CardStatus.REDEEMED }) })
      );
    });

    it('throws INSUFFICIENT_BALANCE when amount exceeds balance', async () => {
      expect(await codeOf(() => ledgerService.redeemCard({ cardId: 'card-1', amount: 999 }))).toBe('INSUFFICIENT_BALANCE');
    });

    it('throws CARD_FROZEN for frozen cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.FROZEN }));
      expect(await codeOf(() => ledgerService.redeemCard({ cardId: 'card-1', amount: 10 }))).toBe('CARD_FROZEN');
    });

    it('throws CARD_EXPIRED for expired cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ expiresAt: new Date('2000-01-01') }));
      expect(await codeOf(() => ledgerService.redeemCard({ cardId: 'card-1', amount: 10 }))).toBe('CARD_EXPIRED');
    });

    it('throws CARD_PENDING for pending cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.PENDING }));
      expect(await codeOf(() => ledgerService.redeemCard({ cardId: 'card-1', amount: 10 }))).toBe('CARD_PENDING');
    });

    // ── MCC restrictions ──────────────────────────────────────────────────

    it('blocks redemption at a blocked merchant category', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({
        campaign: { usageRestrictions: { blockedMerchantCategories: ['5812'] } },
      }));
      expect(await codeOf(() =>
        ledgerService.redeemCard({ cardId: 'card-1', amount: 10, merchantCategory: '5812' })
      )).toBe('MERCHANT_RESTRICTED');
    });

    it('blocks redemption outside allowed merchant categories', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({
        campaign: { usageRestrictions: { allowedMerchantCategories: ['5411'] } }, // grocery only
      }));
      expect(await codeOf(() =>
        ledgerService.redeemCard({ cardId: 'card-1', amount: 10, merchantCategory: '5812' }) // restaurant
      )).toBe('MERCHANT_RESTRICTED');
    });

    it('allows redemption within allowed merchant categories', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({
        campaign: { usageRestrictions: { allowedMerchantCategories: ['5411'] } },
      }));
      const result = await ledgerService.redeemCard({ cardId: 'card-1', amount: 10, merchantCategory: '5411' });
      expect(result).toBeDefined();
    });

    it('blocks a specifically blocked merchant ID', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({
        campaign: { usageRestrictions: { blockedMerchantIds: ['merchant-evil'] } },
      }));
      expect(await codeOf(() =>
        ledgerService.redeemCard({ cardId: 'card-1', amount: 10, merchantId: 'merchant-evil' })
      )).toBe('MERCHANT_RESTRICTED');
    });

    it('stores merchantCategory in ledger metadata', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ campaign: null }));
      await ledgerService.redeemCard({ cardId: 'card-1', amount: 10, merchantCategory: '5812' });
      const call = mockTx.ledgerEntry.create.mock.calls[0][0];
      expect(call.data.metadata).toMatchObject({ merchantCategory: '5812' });
    });
  });

  // ─── refundCard ───────────────────────────────────────────────────────────

  describe('refundCard', () => {
    beforeEach(() => {
      mockTx.ledgerEntry.create.mockResolvedValue(makeEntry(LedgerEntryType.REFUND, 20, 80, 100));
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

    it('throws CARD_CANCELLED for cancelled cards', async () => {
      mockTx.giftCard.findUnique.mockResolvedValue(makeCard({ status: CardStatus.CANCELLED }));
      expect(await codeOf(() => ledgerService.refundCard({ cardId: 'card-1', amount: 10 }))).toBe('CARD_CANCELLED');
    });
  });

  // ─── adjustCard ───────────────────────────────────────────────────────────

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
      expect(await codeOf(() =>
        ledgerService.adjustCard({ cardId: 'card-1', amount: -200, description: 'Too much', actorId: 'user-1' })
      )).toBe('NEGATIVE_BALANCE');
    });
  });

  // ─── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns balance info for a known card', async () => {
      const balanceCard = {
        id: 'card-1', cardNumberMasked: '****-1111', status: CardStatus.ACTIVE,
        currency: 'USD', currentBalance: new Prisma.Decimal(100),
        expiresAt: null, lastTransactionAt: null,
      };
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(balanceCard);
      const result = await ledgerService.getBalance('card-1');
      expect(result.currentBalance).toBeDefined();
    });

    it('throws CARD_NOT_FOUND for unknown card', async () => {
      (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await codeOf(() => ledgerService.getBalance('bad'))).toBe('CARD_NOT_FOUND');
    });
  });

  // ─── transferBalance ──────────────────────────────────────────────────────
  // Each test owns its complete mock setup (Once-values can't be overridden).

  describe('transferBalance', () => {
    const fromCard = makeCard({ id: 'from-card', currentBalance: new Prisma.Decimal(100) });
    const toCard   = makeCard({ id: 'to-card',   currentBalance: new Prisma.Decimal(20)  });

    /** Reset mocks and wire $transaction as callback form for each transfer test */
    function setupTransfer(from: unknown, to: unknown) {
      vi.clearAllMocks();
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)
      );
      mockTx.giftCard.findUnique.mockResolvedValueOnce(from).mockResolvedValueOnce(to);
      mockTx.giftCard.update.mockResolvedValue({});
      mockTx.ledgerEntry.create.mockResolvedValue({ id: 'transfer-entry' });
      mockTx.auditLog.create.mockResolvedValue({});
    }

    it('throws SAME_CARD when from and to are identical', async () => {
      setupTransfer(fromCard, fromCard);
      expect(await codeOf(() =>
        ledgerService.transferBalance({ fromCardId: 'from-card', toCardId: 'from-card', amount: 10, actorId: 'user-1' })
      )).toBe('SAME_CARD');
    });

    it('throws SOURCE_CARD_NOT_FOUND for missing source card', async () => {
      setupTransfer(null, toCard);
      expect(await codeOf(() =>
        ledgerService.transferBalance({ fromCardId: 'bad', toCardId: 'to-card', amount: 10, actorId: 'user-1' })
      )).toBe('SOURCE_CARD_NOT_FOUND');
    });

    it('throws DEST_CARD_NOT_FOUND for missing destination card', async () => {
      setupTransfer(fromCard, null);
      expect(await codeOf(() =>
        ledgerService.transferBalance({ fromCardId: 'from-card', toCardId: 'bad', amount: 10, actorId: 'user-1' })
      )).toBe('DEST_CARD_NOT_FOUND');
    });

    it('throws INSUFFICIENT_BALANCE when transfer amount exceeds source balance', async () => {
      setupTransfer(fromCard, toCard);
      expect(await codeOf(() =>
        ledgerService.transferBalance({ fromCardId: 'from-card', toCardId: 'to-card', amount: 999, actorId: 'user-1' })
      )).toBe('INSUFFICIENT_BALANCE');
    });
  });
});
