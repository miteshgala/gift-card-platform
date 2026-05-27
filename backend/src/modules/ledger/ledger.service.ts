import { CardStatus, LedgerEntryType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { buildMeta, getPrismaSkip } from '../../utils/pagination';
import { dispatchWebhook } from '../webhooks/webhooks.service';
import { WebhookEvent } from '@prisma/client';
import { convertAmount } from '../../utils/fx';

// ─── MCC restriction types ────────────────────────────────────────────────────

interface UsageRestrictions {
  allowedMerchantCategories?: string[];
  blockedMerchantCategories?: string[];
  allowedMerchantIds?: string[];
  blockedMerchantIds?: string[];
}

function enforceUsageRestrictions(
  restrictions: UsageRestrictions,
  merchantCategory?: string,
  merchantId?: string
) {
  const { allowedMerchantCategories, blockedMerchantCategories, allowedMerchantIds, blockedMerchantIds } = restrictions;

  if (merchantCategory) {
    if (blockedMerchantCategories?.includes(merchantCategory)) {
      throw new AppError(403, 'MERCHANT_RESTRICTED', `Merchant category ${merchantCategory} is blocked for this card`);
    }
    if (allowedMerchantCategories?.length && !allowedMerchantCategories.includes(merchantCategory)) {
      throw new AppError(403, 'MERCHANT_RESTRICTED', `Card is restricted to merchant categories: ${allowedMerchantCategories.join(', ')}`);
    }
  }

  if (merchantId) {
    if (blockedMerchantIds?.includes(merchantId)) {
      throw new AppError(403, 'MERCHANT_RESTRICTED', `Merchant ${merchantId} is blocked for this card`);
    }
    if (allowedMerchantIds?.length && !allowedMerchantIds.includes(merchantId)) {
      throw new AppError(403, 'MERCHANT_RESTRICTED', `Card is restricted to specific merchants`);
    }
  }
}

const BALANCE_LOW_THRESHOLD = 10; // $10 default — override via program.metadata.balanceLowThreshold

// ─── Guards ───────────────────────────────────────────────────────────────────

function assertCardActive(status: CardStatus): void {
  if (status === CardStatus.FROZEN) throw new AppError(423, 'CARD_FROZEN', 'Card is frozen');
  if (status === CardStatus.EXPIRED) throw new AppError(410, 'CARD_EXPIRED', 'Card has expired');
  if (status === CardStatus.CANCELLED) throw new AppError(410, 'CARD_CANCELLED', 'Card has been cancelled');
  if (status === CardStatus.REDEEMED) throw new AppError(410, 'CARD_FULLY_REDEEMED', 'Card has been fully redeemed');
  if (status === CardStatus.PENDING) throw new AppError(400, 'CARD_PENDING', 'Card is not yet active');
}

// ─── Load (add funds) ─────────────────────────────────────────────────────────

export interface LoadInput {
  cardId: string;
  amount: number;
  description?: string;
  referenceId?: string;
  actorId?: string;
  ipAddress?: string;
  location?: string;
  fundingCurrency?: string;  // if different from card currency, FX conversion is applied
  metadata?: Record<string, unknown>;
}

export async function loadCard(input: LoadInput) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findUnique({
      where: { id: input.cardId },
      select: { id: true, status: true, currentBalance: true, currency: true, expiresAt: true },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');

    // Check expiry (allow loading PENDING or ACTIVE cards)
    if ([CardStatus.FROZEN, CardStatus.CANCELLED, CardStatus.REDEEMED].includes(card.status)) {
      assertCardActive(card.status);
    }
    if (card.expiresAt && card.expiresAt < new Date()) {
      throw new AppError(410, 'CARD_EXPIRED', 'Card has expired');
    }

    // ─── FX conversion ────────────────────────────────────────────────────────
    let creditAmount = input.amount;
    let fxMeta: Record<string, unknown> = {};
    if (input.fundingCurrency && input.fundingCurrency.toUpperCase() !== card.currency.toUpperCase()) {
      const fx = await convertAmount(input.amount, input.fundingCurrency, card.currency);
      fxMeta = {
        fundingCurrency: input.fundingCurrency,
        fundingAmount: input.amount,
        fxRate: fx.rate,
        fxSource: fx.source,
      };
      creditAmount = fx.convertedAmount;
    }

    const amount = new Prisma.Decimal(creditAmount);
    const balanceBefore = card.currentBalance;
    const balanceAfter = balanceBefore.add(amount);

    const [entry] = await Promise.all([
      tx.ledgerEntry.create({
        data: {
          cardId: card.id,
          type: LedgerEntryType.LOAD,
          amount,
          balanceBefore,
          balanceAfter,
          currency: card.currency,
          referenceId: input.referenceId,
          description: input.description ?? 'Card load',
          ipAddress: input.ipAddress,
          location: input.location,
          metadata: { ...(input.metadata ?? {}), ...fxMeta } as Prisma.InputJsonValue,
        },
      }),
      tx.giftCard.update({
        where: { id: card.id },
        data: {
          currentBalance: balanceAfter,
          status: CardStatus.ACTIVE,
          lastTransactionAt: new Date(),
        },
      }),
    ]);

    if (input.actorId) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'LEDGER_LOAD',
          resourceType: 'GiftCard',
          resourceId: card.id,
          diff: { amount: input.amount, balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() },
        },
      });
    }

    return entry;
  });
}

// ─── Redeem (deduct funds) ────────────────────────────────────────────────────

export interface RedeemInput {
  cardId: string;
  amount: number;
  description?: string;
  referenceId?: string;
  ipAddress?: string;
  location?: string;
  actorId?: string;
  merchantCategory?: string;  // MCC code e.g. "5812"
  merchantId?: string;        // external merchant identifier
  metadata?: Record<string, unknown>;
}

export async function redeemCard(input: RedeemInput) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findUnique({
      where: { id: input.cardId },
      select: {
        id: true, status: true, currentBalance: true, currency: true,
        expiresAt: true, programId: true, campaignId: true,
        campaign: { select: { usageRestrictions: true } },
        program: { select: { metadata: true } },
      },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    assertCardActive(card.status);

    if (card.expiresAt && card.expiresAt < new Date()) {
      throw new AppError(410, 'CARD_EXPIRED', 'Card has expired');
    }

    // ─── MCC / merchant restrictions ───────────────────────────────────────────
    if (card.campaign?.usageRestrictions) {
      enforceUsageRestrictions(
        card.campaign.usageRestrictions as UsageRestrictions,
        input.merchantCategory,
        input.merchantId
      );
    }

    const amount = new Prisma.Decimal(input.amount);
    if (amount.gt(card.currentBalance)) {
      throw new AppError(402, 'INSUFFICIENT_BALANCE', `Insufficient balance. Available: ${card.currentBalance.toString()}`);
    }

    const balanceBefore = card.currentBalance;
    const balanceAfter = balanceBefore.sub(amount);
    const isFullyRedeemed = balanceAfter.equals(0);

    const [entry] = await Promise.all([
      tx.ledgerEntry.create({
        data: {
          cardId: card.id,
          type: LedgerEntryType.REDEEM,
          amount,
          balanceBefore,
          balanceAfter,
          currency: card.currency,
          referenceId: input.referenceId,
          description: input.description ?? 'Card redemption',
          ipAddress: input.ipAddress,
          location: input.location,
          metadata: {
            ...(input.metadata ?? {}),
            ...(input.merchantCategory ? { merchantCategory: input.merchantCategory } : {}),
            ...(input.merchantId ? { merchantId: input.merchantId } : {}),
          } as Prisma.InputJsonValue,
        },
      }),
      tx.giftCard.update({
        where: { id: card.id },
        data: {
          currentBalance: balanceAfter,
          status: isFullyRedeemed ? CardStatus.REDEEMED : CardStatus.ACTIVE,
          redeemedAt: isFullyRedeemed ? new Date() : undefined,
          lastTransactionAt: new Date(),
          lastLocation: input.location,
        },
      }),
    ]);

    if (input.actorId) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'LEDGER_REDEEM',
          resourceType: 'GiftCard',
          resourceId: card.id,
          diff: { amount: input.amount, balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() },
        },
      });
    }

    const result = { entry, isFullyRedeemed, remainingBalance: balanceAfter.toString() };

    // ─── Post-commit: fire BALANCE_LOW webhook if threshold crossed ──────────
    const threshold = new Prisma.Decimal(
      (card.program?.metadata as Record<string, unknown>)?.balanceLowThreshold as number
        ?? BALANCE_LOW_THRESHOLD
    );
    if (!isFullyRedeemed && balanceAfter.lte(threshold) && balanceBefore.gt(threshold)) {
      dispatchWebhook(card.programId, WebhookEvent.BALANCE_LOW, {
        event: WebhookEvent.BALANCE_LOW,
        cardId: card.id,
        remainingBalance: balanceAfter.toString(),
        threshold: threshold.toString(),
        currency: card.currency,
      }, card.id).catch(() => {});
    }

    return result;
  });
}

// ─── Refund ───────────────────────────────────────────────────────────────────

export interface RefundInput {
  cardId: string;
  amount: number;
  referenceId?: string;
  description?: string;
  actorId?: string;
  ipAddress?: string;
}

export async function refundCard(input: RefundInput) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findUnique({
      where: { id: input.cardId },
      select: { id: true, status: true, currentBalance: true, currency: true },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    if (card.status === CardStatus.CANCELLED) {
      throw new AppError(400, 'CARD_CANCELLED', 'Cannot refund a cancelled card');
    }

    const amount = new Prisma.Decimal(input.amount);
    const balanceBefore = card.currentBalance;
    const balanceAfter = balanceBefore.add(amount);

    const [entry] = await Promise.all([
      tx.ledgerEntry.create({
        data: {
          cardId: card.id,
          type: LedgerEntryType.REFUND,
          amount,
          balanceBefore,
          balanceAfter,
          currency: card.currency,
          referenceId: input.referenceId,
          description: input.description ?? 'Refund',
          ipAddress: input.ipAddress,
        },
      }),
      tx.giftCard.update({
        where: { id: card.id },
        data: {
          currentBalance: balanceAfter,
          status: CardStatus.ACTIVE, // reactivate if was REDEEMED
          redeemedAt: null,
          lastTransactionAt: new Date(),
        },
      }),
    ]);

    if (input.actorId) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'LEDGER_REFUND',
          resourceType: 'GiftCard',
          resourceId: card.id,
          diff: { amount: input.amount },
        },
      });
    }

    return entry;
  });
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

export interface AdjustmentInput {
  cardId: string;
  amount: number; // positive = credit, negative = debit
  description: string;
  actorId: string;
  referenceId?: string;
}

export async function adjustCard(input: AdjustmentInput) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findUnique({
      where: { id: input.cardId },
      select: { id: true, status: true, currentBalance: true, currency: true },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');

    const amount = new Prisma.Decimal(Math.abs(input.amount));
    const isCredit = input.amount > 0;
    const balanceBefore = card.currentBalance;
    const balanceAfter = isCredit ? balanceBefore.add(amount) : balanceBefore.sub(amount);

    if (balanceAfter.lt(0)) {
      throw new AppError(400, 'NEGATIVE_BALANCE', 'Adjustment would result in negative balance');
    }

    const [entry] = await Promise.all([
      tx.ledgerEntry.create({
        data: {
          cardId: card.id,
          type: LedgerEntryType.ADJUSTMENT,
          amount: new Prisma.Decimal(input.amount), // can be negative for debit
          balanceBefore,
          balanceAfter,
          currency: card.currency,
          referenceId: input.referenceId,
          description: input.description,
        },
      }),
      tx.giftCard.update({
        where: { id: card.id },
        data: { currentBalance: balanceAfter, lastTransactionAt: new Date() },
      }),
      tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'LEDGER_ADJUSTMENT',
          resourceType: 'GiftCard',
          resourceId: card.id,
          diff: { amount: input.amount, description: input.description },
        },
      }),
    ]);

    return entry;
  });
}

// ─── Card-to-card transfer ────────────────────────────────────────────────────

export interface TransferInput {
  fromCardId: string;
  toCardId: string;
  amount: number;
  description?: string;
  referenceId?: string;
  actorId: string;
  ipAddress?: string;
}

export async function transferBalance(input: TransferInput) {
  return prisma.$transaction(async (tx) => {
    const [fromCard, toCard] = await Promise.all([
      tx.giftCard.findUnique({
        where: { id: input.fromCardId },
        select: { id: true, status: true, currentBalance: true, currency: true, expiresAt: true },
      }),
      tx.giftCard.findUnique({
        where: { id: input.toCardId },
        select: { id: true, status: true, currentBalance: true, currency: true, expiresAt: true },
      }),
    ]);

    if (!fromCard) throw new AppError(404, 'SOURCE_CARD_NOT_FOUND', 'Source card not found');
    if (!toCard) throw new AppError(404, 'DEST_CARD_NOT_FOUND', 'Destination card not found');
    if (input.fromCardId === input.toCardId) throw new AppError(400, 'SAME_CARD', 'Cannot transfer to the same card');

    assertCardActive(fromCard.status);
    assertCardActive(toCard.status);

    if (fromCard.currency !== toCard.currency) {
      throw new AppError(400, 'CURRENCY_MISMATCH',
        `Cannot transfer between cards with different currencies (${fromCard.currency} → ${toCard.currency})`);
    }

    const amount = new Prisma.Decimal(input.amount);
    if (amount.gt(fromCard.currentBalance)) {
      throw new AppError(402, 'INSUFFICIENT_BALANCE',
        `Insufficient balance. Available: ${fromCard.currentBalance.toString()}`);
    }

    const fromBalanceBefore = fromCard.currentBalance;
    const fromBalanceAfter = fromBalanceBefore.sub(amount);
    const toBalanceBefore = toCard.currentBalance;
    const toBalanceAfter = toBalanceBefore.add(amount);
    const now = new Date();
    const description = input.description ?? `Transfer to card ...${toCard.id.slice(-4)}`;

    const [outEntry, inEntry] = await Promise.all([
      tx.ledgerEntry.create({
        data: {
          cardId: fromCard.id,
          type: LedgerEntryType.TRANSFER_OUT,
          amount,
          balanceBefore: fromBalanceBefore,
          balanceAfter: fromBalanceAfter,
          currency: fromCard.currency,
          referenceId: input.referenceId,
          description,
          ipAddress: input.ipAddress,
        },
      }),
      tx.ledgerEntry.create({
        data: {
          cardId: toCard.id,
          type: LedgerEntryType.TRANSFER_IN,
          amount,
          balanceBefore: toBalanceBefore,
          balanceAfter: toBalanceAfter,
          currency: toCard.currency,
          referenceId: input.referenceId,
          description: `Transfer from card ...${fromCard.id.slice(-4)}`,
          ipAddress: input.ipAddress,
        },
      }),
    ]);

    await Promise.all([
      tx.giftCard.update({
        where: { id: fromCard.id },
        data: {
          currentBalance: fromBalanceAfter,
          status: fromBalanceAfter.equals(0) ? CardStatus.REDEEMED : CardStatus.ACTIVE,
          lastTransactionAt: now,
        },
      }),
      tx.giftCard.update({
        where: { id: toCard.id },
        data: { currentBalance: toBalanceAfter, lastTransactionAt: now },
      }),
      tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: 'LEDGER_ADJUSTMENT',
          resourceType: 'GiftCard',
          resourceId: fromCard.id,
          diff: {
            type: 'TRANSFER',
            amount: input.amount,
            fromCard: fromCard.id,
            toCard: toCard.id,
          },
        },
      }),
    ]);

    return {
      outEntry,
      inEntry,
      fromCard: { id: fromCard.id, newBalance: fromBalanceAfter.toString() },
      toCard: { id: toCard.id, newBalance: toBalanceAfter.toString() },
    };
  });
}

// ─── Balance query ────────────────────────────────────────────────────────────

export async function getBalance(cardId: string) {
  const card = await prisma.giftCard.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      cardNumberMasked: true,
      status: true,
      currency: true,
      currentBalance: true,
      expiresAt: true,
      lastTransactionAt: true,
    },
  });
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
  return card;
}

// ─── Transaction history ──────────────────────────────────────────────────────

export async function getTransactionHistory(
  cardId: string,
  options: { page?: number; limit?: number; type?: LedgerEntryType }
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;

  const where: Prisma.LedgerEntryWhereInput = {
    cardId,
    ...(options.type && { type: options.type }),
  };

  const [entries, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      skip: getPrismaSkip(page, limit),
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return { entries, meta: buildMeta(total, page, limit) };
}
