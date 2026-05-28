import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardStatus, CardType, KycStatus, Prisma } from '@prisma/client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../config/prisma', () => ({
  prisma: {
    giftCard: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    kycCheck: { create: vi.fn() },
    fraudFlag: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Crypto helpers are deterministic — just mock the hashing to avoid bcrypt delay
vi.mock('../utils/crypto', () => ({
  generateCardNumber: vi.fn(() => '4111111111111111'),
  generatePin: vi.fn(() => '1234'),
  hashCardNumber: vi.fn((n: string) => `hash:${n}`),
  hashPin: vi.fn(async () => 'hashed-pin'),
  maskCardNumber: vi.fn(() => '****-****-****-1111'),
  verifyPin: vi.fn(async () => true),
}));

import * as cardsService from '../modules/cards/cards.service';
import { prisma } from '../config/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const codeOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e: unknown) { return (e as { code?: string }).code; }
};

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: 'card-abc',
  status: CardStatus.ACTIVE,
  cardType: CardType.DIGITAL,
  currentBalance: new Prisma.Decimal(50),
  initialBalance: new Prisma.Decimal(50),
  currency: 'USD',
  programId: 'prog-1',
  pinHash: 'hashed-pin',
  pinAttempts: 0,
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  ...overrides,
});

const issueInput = (overrides: Partial<cardsService.IssueCardInput> = {}): cardsService.IssueCardInput => ({
  programId: 'prog-1',
  initialBalance: 100,
  ...overrides,
});

// ─── issueCard ─────────────────────────────────────────────────────────────────

describe('cardsService.issueCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.giftCard.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard());
    (prisma.kycCheck.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'kyc-1' });
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('issues a DIGITAL card as ACTIVE', async () => {
    const result = await cardsService.issueCard(issueInput({ cardType: CardType.DIGITAL }));
    const createCall = (prisma.giftCard.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.status).toBe(CardStatus.ACTIVE);
    expect(result.kycRequired).toBe(false);
  });

  it('issues a PHYSICAL card as PENDING', async () => {
    (prisma.giftCard.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard({ status: CardStatus.PENDING, cardType: CardType.PHYSICAL }));
    await cardsService.issueCard(issueInput({ cardType: CardType.PHYSICAL, initialBalance: 50 }));
    const createCall = (prisma.giftCard.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.status).toBe(CardStatus.PENDING);
    expect(createCall.data.activatedAt).toBeNull();
  });

  it('holds DIGITAL card as PENDING and creates KycCheck when balance >= KYC_THRESHOLD', async () => {
    // Default KYC_THRESHOLD is 1000
    (prisma.giftCard.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard({ status: CardStatus.PENDING, initialBalance: new Prisma.Decimal(1500) }));
    const result = await cardsService.issueCard(issueInput({ initialBalance: 1500 }));
    const createCall = (prisma.giftCard.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.status).toBe(CardStatus.PENDING);
    expect(createCall.data.activatedAt).toBeNull();
    expect(prisma.kycCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cardId: 'card-abc' }),
      })
    );
    expect(result.kycRequired).toBe(true);
  });

  it('does NOT create KycCheck when balance < KYC_THRESHOLD', async () => {
    await cardsService.issueCard(issueInput({ initialBalance: 100 }));
    expect(prisma.kycCheck.create).not.toHaveBeenCalled();
  });

  it('returns plaintext cardNumber and pin', async () => {
    const result = await cardsService.issueCard(issueInput());
    expect(result.cardNumber).toBe('4111111111111111');
    expect(result.pin).toBe('1234');
  });

  it('uses program default currency (USD) when none specified', async () => {
    await cardsService.issueCard(issueInput());
    const createCall = (prisma.giftCard.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.currency).toBe('USD');
  });

  it('uses specified currency', async () => {
    await cardsService.issueCard(issueInput({ currency: 'EUR' }));
    const createCall = (prisma.giftCard.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.currency).toBe('EUR');
  });
});

// ─── freezeCard ───────────────────────────────────────────────────────────────

describe('cardsService.freezeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard());
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([makeCard({ status: CardStatus.FROZEN }), {}]);
  });

  it('throws CARD_NOT_FOUND for unknown card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await codeOf(() => cardsService.freezeCard('bad', 'suspicious', 'user-1'))).toBe('CARD_NOT_FOUND');
  });

  it('throws ALREADY_FROZEN for a frozen card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard({ status: CardStatus.FROZEN }));
    expect(await codeOf(() => cardsService.freezeCard('card-abc', 'suspicious', 'user-1'))).toBe('ALREADY_FROZEN');
  });

  it('freezes an ACTIVE card', async () => {
    const result = await cardsService.freezeCard('card-abc', 'suspicious', 'user-1');
    expect(result).toBeDefined();
  });
});

// ─── lookupCard ───────────────────────────────────────────────────────────────

describe('cardsService.lookupCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ pinAttempts: 0, pinLockedUntil: null })
    );
    (prisma.giftCard.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('returns card when card number and PIN are valid', async () => {
    const card = await cardsService.lookupCard('4111111111111111', '1234');
    expect(card).toBeDefined();
  });

  it('throws CARD_NOT_FOUND for unknown card number', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await codeOf(() => cardsService.lookupCard('0000000000000000', '1234'))).toBe('CARD_NOT_FOUND');
  });

  it('throws INVALID_PIN for wrong PIN', async () => {
    const { verifyPin } = await import('../utils/crypto');
    (verifyPin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    expect(await codeOf(() => cardsService.lookupCard('4111111111111111', '9999'))).toBe('INVALID_PIN');
  });

  it('throws CARD_LOCKED when pin is locked', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ pinLockedUntil: new Date(Date.now() + 60_000) })
    );
    expect(await codeOf(() => cardsService.lookupCard('4111111111111111', '1234'))).toBe('CARD_LOCKED');
  });
});

// ─── reissueCard ──────────────────────────────────────────────────────────────

describe('cardsService.reissueCard', () => {
  const oldCard = makeCard({
    id: 'old-card',
    status: CardStatus.ACTIVE,
    cardType: CardType.DIGITAL,
    currentBalance: new Prisma.Decimal(75),
    currency: 'USD',
    recipientEmail: 'user@example.com',
    recipientName: 'Test User',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    metadata: null,
  });

  const newCard = makeCard({ id: 'new-card', status: CardStatus.ACTIVE });

  const mockTxReissue = {
    giftCard: { update: vi.fn(), create: vi.fn() },
    ledgerEntry: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(oldCard);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: (tx: typeof mockTxReissue) => Promise<unknown>) => fn(mockTxReissue)
    );
    mockTxReissue.giftCard.update.mockResolvedValue({ ...oldCard, status: CardStatus.CANCELLED });
    mockTxReissue.giftCard.create.mockResolvedValue(newCard);
    mockTxReissue.ledgerEntry.create.mockResolvedValue({ id: 'entry' });
    mockTxReissue.auditLog.create.mockResolvedValue({});
  });

  it('throws CARD_NOT_FOUND for unknown card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await codeOf(() => cardsService.reissueCard('bad', 'lost', 'user-1'))).toBe('CARD_NOT_FOUND');
  });

  it('throws INVALID_STATUS for CANCELLED card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ status: CardStatus.CANCELLED })
    );
    expect(await codeOf(() => cardsService.reissueCard('old-card', 'lost', 'user-1'))).toBe('INVALID_STATUS');
  });

  it('throws INVALID_STATUS for REDEEMED card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ status: CardStatus.REDEEMED })
    );
    expect(await codeOf(() => cardsService.reissueCard('old-card', 'lost', 'user-1'))).toBe('INVALID_STATUS');
  });

  it('cancels old card and creates replacement in transaction', async () => {
    await cardsService.reissueCard('old-card', 'card lost', 'user-1');
    expect(mockTxReissue.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: CardStatus.CANCELLED }) })
    );
    expect(mockTxReissue.giftCard.create).toHaveBeenCalled();
  });

  it('writes both TRANSFER_OUT and TRANSFER_IN ledger entries', async () => {
    await cardsService.reissueCard('old-card', 'card lost', 'user-1');
    const types = mockTxReissue.ledgerEntry.create.mock.calls.map(
      (c: [{ data: { type: string } }]) => c[0].data.type
    );
    expect(types).toContain('TRANSFER_OUT');
    expect(types).toContain('TRANSFER_IN');
  });

  it('returns plaintext cardNumber and pin for the new card', async () => {
    const result = await cardsService.reissueCard('old-card', 'card lost', 'user-1');
    expect(result.cardNumber).toBe('4111111111111111');
    expect(result.pin).toBe('1234');
  });
});

// ─── activateCard ──────────────────────────────────────────────────────────────

describe('cardsService.activateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ status: CardStatus.PENDING, cardType: CardType.PHYSICAL })
    );
    (prisma.giftCard.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeCard({ status: CardStatus.ACTIVE }));
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // activateCard uses the array form of $transaction — return [updatedCard, auditLog]
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([makeCard({ status: CardStatus.ACTIVE }), {}]);
  });

  it('activates a PENDING PHYSICAL card', async () => {
    const result = await cardsService.activateCard('card-abc', '1234', 'user-1');
    expect(prisma.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CardStatus.ACTIVE }),
      })
    );
    expect(result).toBeDefined();
  });

  it('throws CARD_NOT_FOUND for unknown card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await codeOf(() => cardsService.activateCard('bad', '1234', 'user-1'))).toBe('CARD_NOT_FOUND');
  });

  it('throws NOT_PHYSICAL for a DIGITAL card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ status: CardStatus.PENDING, cardType: CardType.DIGITAL })
    );
    expect(await codeOf(() => cardsService.activateCard('card-abc', '1234', 'user-1'))).toBe('NOT_PHYSICAL');
  });

  it('throws ALREADY_ACTIVATED for an already-activated card', async () => {
    (prisma.giftCard.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCard({ status: CardStatus.ACTIVE, cardType: CardType.PHYSICAL })
    );
    expect(await codeOf(() => cardsService.activateCard('card-abc', '1234', 'user-1'))).toBe('ALREADY_ACTIVATED');
  });

  it('throws INVALID_PIN for incorrect PIN', async () => {
    const { verifyPin } = await import('../utils/crypto');
    (verifyPin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    expect(await codeOf(() => cardsService.activateCard('card-abc', '9999', 'user-1'))).toBe('INVALID_PIN');
  });
});
