import { CardStatus, CardType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import {
  generateCardNumber,
  generatePin,
  hashCardNumber,
  hashPin,
  maskCardNumber,
  verifyPin,
} from '../../utils/crypto';
import { env } from '../../config/env';
import { buildMeta, getPrismaSkip } from '../../utils/pagination';

// ─── Issue a single card ──────────────────────────────────────────────────────

export interface IssueCardInput {
  programId: string;
  campaignId?: string;
  orderId?: string;
  cardType?: CardType;
  denomination?: number;
  initialBalance: number;
  currency?: string;
  recipientEmail?: string;
  recipientName?: string;
  expiryDays?: number;
  metadata?: Record<string, unknown>;
}

export async function issueCard(input: IssueCardInput) {
  const cardNumber = generateCardNumber();
  const pin = generatePin();
  const cardNumberHash = hashCardNumber(cardNumber);
  const pinHash = await hashPin(pin);
  const cardNumberMasked = maskCardNumber(cardNumber);

  const expiryDays = input.expiryDays ?? env.DEFAULT_CARD_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const isPhysical = input.cardType === CardType.PHYSICAL;
  const needsKyc = !isPhysical && input.initialBalance >= env.KYC_THRESHOLD;

  const card = await prisma.giftCard.create({
    data: {
      programId: input.programId,
      campaignId: input.campaignId,
      orderId: input.orderId,
      cardNumberHash,
      cardNumberMasked,
      pinHash,
      cardType: input.cardType ?? CardType.DIGITAL,
      // Physical cards and high-value digital cards start PENDING
      status: (isPhysical || needsKyc) ? CardStatus.PENDING : CardStatus.ACTIVE,
      currency: input.currency ?? 'USD',
      initialBalance: new Prisma.Decimal(input.initialBalance),
      currentBalance: new Prisma.Decimal(input.initialBalance),
      denomination: input.denomination ? new Prisma.Decimal(input.denomination) : null,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      expiresAt,
      activatedAt: (isPhysical || needsKyc) ? null : new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  // Create KYC check record for high-value digital cards
  if (needsKyc) {
    await prisma.kycCheck.create({
      data: {
        cardId: card.id,
        recipientEmail: input.recipientEmail,
        amount: new Prisma.Decimal(input.initialBalance),
      },
    });
  }

  // Return the plaintext card number and PIN ONCE — never stored in plaintext
  return {
    card,
    cardNumber, // plaintext, return to caller
    pin,         // plaintext, return to caller
    kycRequired: needsKyc,
  };
}

// ─── Lookup card by number + PIN ──────────────────────────────────────────────

export async function lookupCard(cardNumber: string, pin: string) {
  const cardNumberHash = hashCardNumber(cardNumber);

  const card = await prisma.giftCard.findUnique({ where: { cardNumberHash } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');

  // Check PIN lockout
  if (card.pinLockedUntil && card.pinLockedUntil > new Date()) {
    const unlockAt = card.pinLockedUntil.toISOString();
    throw new AppError(423, 'CARD_LOCKED', `Card is locked due to too many PIN attempts. Unlocks at ${unlockAt}`);
  }

  const pinValid = await verifyPin(pin, card.pinHash);
  if (!pinValid) {
    const attempts = card.pinAttempts + 1;
    const shouldLock = attempts >= env.MAX_PIN_ATTEMPTS;
    await prisma.giftCard.update({
      where: { id: card.id },
      data: {
        pinAttempts: attempts,
        pinLockedUntil: shouldLock
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : null,
      },
    });
    if (shouldLock) {
      throw new AppError(423, 'CARD_LOCKED', 'Card locked for 24 hours after too many failed PIN attempts');
    }
    throw new AppError(401, 'INVALID_PIN', `Invalid PIN. ${env.MAX_PIN_ATTEMPTS - attempts} attempts remaining`);
  }

  // Reset PIN attempts on success
  if (card.pinAttempts > 0) {
    await prisma.giftCard.update({
      where: { id: card.id },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });
  }

  return card;
}

// ─── Get card by ID ───────────────────────────────────────────────────────────

export async function getCardById(cardId: string, programId?: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if (programId && card.programId !== programId) {
    throw new AppError(403, 'FORBIDDEN', 'Card does not belong to this program');
  }
  return card;
}

// ─── List cards ───────────────────────────────────────────────────────────────

export async function listCards(filters: {
  programId?: string;
  status?: CardStatus;
  cardType?: CardType;
  recipientEmail?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const where: Prisma.GiftCardWhereInput = {
    ...(filters.programId && { programId: filters.programId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.cardType && { cardType: filters.cardType }),
    ...(filters.recipientEmail && { recipientEmail: { contains: filters.recipientEmail, mode: 'insensitive' } }),
    ...(filters.search && {
      OR: [
        { cardNumberMasked: { contains: filters.search } },
        { recipientEmail: { contains: filters.search, mode: 'insensitive' } },
        { recipientName: { contains: filters.search, mode: 'insensitive' } },
      ],
    }),
  };

  const [cards, total] = await Promise.all([
    prisma.giftCard.findMany({
      where,
      skip: getPrismaSkip(page, limit),
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cardNumberMasked: true,
        cardType: true,
        status: true,
        currency: true,
        initialBalance: true,
        currentBalance: true,
        denomination: true,
        recipientEmail: true,
        recipientName: true,
        expiresAt: true,
        activatedAt: true,
        createdAt: true,
        programId: true,
        campaignId: true,
      },
    }),
    prisma.giftCard.count({ where }),
  ]);

  return { cards, meta: buildMeta(total, page, limit) };
}

// ─── Freeze / Unfreeze ────────────────────────────────────────────────────────

export async function freezeCard(cardId: string, reason: string, actorId: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if (card.status === CardStatus.FROZEN) throw new AppError(409, 'ALREADY_FROZEN', 'Card is already frozen');
  if ([CardStatus.REDEEMED, CardStatus.CANCELLED, CardStatus.EXPIRED].includes(card.status)) {
    throw new AppError(400, 'INVALID_STATUS', `Cannot freeze a ${card.status} card`);
  }

  const [updated] = await prisma.$transaction([
    prisma.giftCard.update({
      where: { id: cardId },
      data: { status: CardStatus.FROZEN, frozenAt: new Date() },
    }),
    prisma.fraudFlag.create({
      data: {
        cardId,
        reason,
        severity: 'MEDIUM',
        details: { frozenBy: actorId },
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'CARD_FREEZE',
        resourceType: 'GiftCard',
        resourceId: cardId,
        diff: { reason },
      },
    }),
  ]);

  return updated;
}

export async function unfreezeCard(cardId: string, actorId: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if (card.status !== CardStatus.FROZEN) throw new AppError(400, 'NOT_FROZEN', 'Card is not frozen');

  const [updated] = await prisma.$transaction([
    prisma.giftCard.update({
      where: { id: cardId },
      data: { status: CardStatus.ACTIVE, frozenAt: null },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'CARD_UNFREEZE',
        resourceType: 'GiftCard',
        resourceId: cardId,
      },
    }),
  ]);

  return updated;
}

// ─── Activate physical card ───────────────────────────────────────────────────

export async function activateCard(cardId: string, pin: string, actorId: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if (card.cardType !== 'PHYSICAL') {
    throw new AppError(400, 'NOT_PHYSICAL', 'Only physical cards require activation');
  }
  if (card.status !== 'PENDING') {
    throw new AppError(409, 'ALREADY_ACTIVATED', `Card is already ${card.status.toLowerCase()}`);
  }

  // Verify PIN lockout
  if (card.pinLockedUntil && card.pinLockedUntil > new Date()) {
    throw new AppError(423, 'CARD_LOCKED',
      `Card locked due to too many PIN attempts. Unlocks at ${card.pinLockedUntil.toISOString()}`);
  }

  const pinValid = await verifyPin(pin, card.pinHash);
  if (!pinValid) {
    const attempts = card.pinAttempts + 1;
    const shouldLock = attempts >= env.MAX_PIN_ATTEMPTS;
    await prisma.giftCard.update({
      where: { id: cardId },
      data: {
        pinAttempts: attempts,
        pinLockedUntil: shouldLock ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
      },
    });
    if (shouldLock) throw new AppError(423, 'CARD_LOCKED', 'Card locked for 24 hours after too many failed PIN attempts');
    throw new AppError(401, 'INVALID_PIN', `Invalid PIN. ${env.MAX_PIN_ATTEMPTS - attempts} attempts remaining`);
  }

  const [activated] = await prisma.$transaction([
    prisma.giftCard.update({
      where: { id: cardId },
      data: { status: 'ACTIVE', activatedAt: new Date(), pinAttempts: 0, pinLockedUntil: null },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'CARD_ACTIVATE',
        resourceType: 'GiftCard',
        resourceId: cardId,
      },
    }),
  ]);

  return activated;
}

// ─── Reissue / replace a card ─────────────────────────────────────────────────

export async function reissueCard(cardId: string, reason: string, actorId: string) {
  const old = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!old) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if ([CardStatus.CANCELLED, CardStatus.REDEEMED].includes(old.status)) {
    throw new AppError(400, 'INVALID_STATUS', `Cannot reissue a ${old.status} card`);
  }

  // Generate new card credentials
  const newCardNumber = generateCardNumber();
  const newPin = generatePin();
  const newCardNumberHash = hashCardNumber(newCardNumber);
  const newPinHash = await hashPin(newPin);
  const newCardNumberMasked = maskCardNumber(newCardNumber);

  const remainingBalance = old.currentBalance;
  const expiresAt = old.expiresAt; // preserve original expiry

  const result = await prisma.$transaction(async (tx) => {
    // 1. Cancel the old card and zero its balance
    const cancelled = await tx.giftCard.update({
      where: { id: cardId },
      data: { status: CardStatus.CANCELLED, cancelledAt: new Date(), currentBalance: new Prisma.Decimal(0) },
    });

    // 2. Write a TRANSFER_OUT ledger on the old card
    await tx.ledgerEntry.create({
      data: {
        cardId: old.id,
        type: 'TRANSFER_OUT',
        amount: remainingBalance,
        balanceBefore: remainingBalance,
        balanceAfter: new Prisma.Decimal(0),
        currency: old.currency,
        description: `Reissue: balance transferred to replacement card — ${reason}`,
      },
    });

    // 3. Issue replacement card in same program/campaign with carried-over balance
    const newCard = await tx.giftCard.create({
      data: {
        programId: old.programId,
        campaignId: old.campaignId,
        cardNumberHash: newCardNumberHash,
        cardNumberMasked: newCardNumberMasked,
        pinHash: newPinHash,
        cardType: old.cardType,
        status: old.cardType === CardType.PHYSICAL ? CardStatus.PENDING : CardStatus.ACTIVE,
        currency: old.currency,
        initialBalance: remainingBalance,
        currentBalance: remainingBalance,
        recipientEmail: old.recipientEmail,
        recipientName: old.recipientName,
        expiresAt,
        activatedAt: old.cardType === CardType.PHYSICAL ? null : new Date(),
        metadata: old.metadata,
      },
    });

    // 4. Write a TRANSFER_IN ledger on the new card
    await tx.ledgerEntry.create({
      data: {
        cardId: newCard.id,
        type: 'TRANSFER_IN',
        amount: remainingBalance,
        balanceBefore: new Prisma.Decimal(0),
        balanceAfter: remainingBalance,
        currency: newCard.currency,
        description: `Reissue: balance carried over from card ...${old.id.slice(-4)}`,
      },
    });

    // 5. Audit log on old card
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'CARD_CANCEL',
        resourceType: 'GiftCard',
        resourceId: old.id,
        diff: { reason, reissuedAs: newCard.id, balanceTransferred: remainingBalance.toString() },
      },
    });

    // 6. Audit log on new card
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'CARD_CREATE',
        resourceType: 'GiftCard',
        resourceId: newCard.id,
        diff: { reissueOf: old.id, reason },
      },
    });

    return { cancelled, newCard };
  });

  return {
    oldCard: result.cancelled,
    newCard: result.newCard,
    cardNumber: newCardNumber,  // plaintext — return once
    pin: newPin,
  };
}

export async function cancelCard(cardId: string, reason: string, actorId: string) {
  const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  if ([CardStatus.CANCELLED, CardStatus.REDEEMED].includes(card.status)) {
    throw new AppError(400, 'INVALID_STATUS', `Cannot cancel a ${card.status} card`);
  }

  const [updated] = await prisma.$transaction([
    prisma.giftCard.update({
      where: { id: cardId },
      data: { status: CardStatus.CANCELLED, cancelledAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'CARD_CANCEL',
        resourceType: 'GiftCard',
        resourceId: cardId,
        diff: { reason },
      },
    }),
  ]);

  return updated;
}
