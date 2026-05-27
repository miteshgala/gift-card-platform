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

  const card = await prisma.giftCard.create({
    data: {
      programId: input.programId,
      campaignId: input.campaignId,
      orderId: input.orderId,
      cardNumberHash,
      cardNumberMasked,
      pinHash,
      cardType: input.cardType ?? CardType.DIGITAL,
      status: CardStatus.ACTIVE,
      currency: input.currency ?? 'USD',
      initialBalance: new Prisma.Decimal(input.initialBalance),
      currentBalance: new Prisma.Decimal(input.initialBalance),
      denomination: input.denomination ? new Prisma.Decimal(input.denomination) : null,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      expiresAt,
      activatedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  // Return the plaintext card number and PIN ONCE — never stored in plaintext
  return {
    card,
    cardNumber, // plaintext, return to caller
    pin,         // plaintext, return to caller
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
