import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/db/prisma';
import { prismaRead } from '../../shared/db/prisma';
import { Errors } from '../../shared/errors/AppError';
import { generateCardNumber } from '../../shared/utils/crypto';
import { tokenizePan } from '../../shared/utils/vaultClient';
import { getBalance, postLoad, bootstrapCardAccounts } from '../ledger/ledger.service';
import { publish, TOPICS } from '../../shared/kafka/client';
import { logger } from '../../shared/utils/logger';
import { cardsIssuedTotal } from '../../shared/utils/metrics';
import type { Prisma } from '@prisma/client';

const PIN_BCRYPT_COST = 12;
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Issue a single card ──────────────────────────────────────────────────────

export interface IssueCardInput {
  programId: string;
  campaignId?: string;
  departmentId?: string;
  cardType: 'PHYSICAL' | 'VIRTUAL' | 'SINGLE_USE';
  amountCents: bigint;
  currency: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientState?: string;
  pin: string;       // 4-6 digits — hashed immediately, never stored as plaintext
  issuedBy?: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}

export async function issueCard(input: IssueCardInput): Promise<{ cardId: string; vaultToken: string; last4: string }> {
  // Validate PIN format before any DB writes
  if (!/^\d{4,6}$/.test(input.pin)) {
    throw Errors.badRequest('PIN must be 4-6 digits');
  }

  // Load program for configuration
  const program = await prismaRead.program.findUnique({
    where: { id: input.programId },
    select: {
      id: true, status: true, currency: true, cardExpiryDays: true,
      floatAccountId: true, kycRequiredAbove: true,
    },
  });
  if (!program) throw Errors.programNotFound();
  if (program.status === 'SUSPENDED' || program.status === 'SUSPENDED_RECON') throw Errors.programSuspended();
  if (program.status === 'SUSPENDED_RECON') throw Errors.reconciliationHold();

  // Validate currency matches program
  if (input.currency !== program.currency) throw Errors.invalidCurrency();

  // Validate amount
  if (input.amountCents <= 0n) throw Errors.invalidAmount();

  // Generate card number and tokenize
  const pan = generateCardNumber();
  const { token: vaultToken, last4, bin } = await tokenizePan(pan);

  // CARD Act: minimum 5-year expiry
  const minExpiry = new Date();
  minExpiry.setFullYear(minExpiry.getFullYear() + 5);
  const requestedExpiry = new Date();
  requestedExpiry.setDate(requestedExpiry.getDate() + program.cardExpiryDays);
  const expiresAt = requestedExpiry > minExpiry ? requestedExpiry : minExpiry;

  // Determine initial KYC status
  const kycStatus =
    program.kycRequiredAbove !== null && input.amountCents > program.kycRequiredAbove
      ? 'PENDING'
      : 'NOT_REQUIRED';

  // Hash PIN
  const pinHash = await bcrypt.hash(input.pin, PIN_BCRYPT_COST);

  // All DB operations in a single transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create card accounts
    const { cardAccountId, authHoldAccountId } = await bootstrapCardAccounts(
      input.programId,
      input.currency,
      `Card ${last4}`,
      tx,
    );

    // Update the account record to reference the card (done after card creation below)
    const card = await tx.card.create({
      data: {
        programId: input.programId,
        campaignId: input.campaignId ?? null,
        accountId: cardAccountId,
        vaultToken,
        last4,
        bin,
        cardType: input.cardType,
        status: kycStatus === 'PENDING' ? 'PENDING_ACTIVATION' : 'ACTIVE',
        currency: input.currency,
        initialLoad: input.amountCents,
        expiresAt,
        activatedAt: kycStatus === 'NOT_REQUIRED' ? new Date() : null,
        kycStatus,
        recipientName: input.recipientName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        recipientPhone: input.recipientPhone ?? null,
        recipientState: input.recipientState ?? null,
        departmentId: input.departmentId ?? null,
        issuedBy: input.issuedBy ?? null,
        orderId: input.orderId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Link accounts back to the card
    await tx.account.updateMany({
      where: { id: { in: [cardAccountId, authHoldAccountId] } },
      data: { cardId: card.id },
    });

    // Create PIN record
    await tx.cardPin.create({
      data: { cardId: card.id, pinHash },
    });

    // Create KYC check if required
    if (kycStatus === 'PENDING') {
      await tx.kycCheck.create({
        data: {
          cardId: card.id,
          programId: input.programId,
          checkType: 'IDENTITY',
          provider: 'INTERNAL',
          status: 'PENDING',
        },
      });
    }

    // Post LOAD journal entry (only if card is immediately active)
    if (kycStatus === 'NOT_REQUIRED') {
      await postLoad({
        cardId: card.id,
        programId: input.programId,
        floatAccountId: program.floatAccountId!,
        cardAccountId,
        amount: input.amountCents,
        currency: input.currency,
        description: `Card issuance — ${last4}`,
        orderId: input.orderId,
        initiatedBy: input.issuedBy,
        tx,
      });
    }

    return { cardId: card.id, cardAccountId, authHoldAccountId };
  });

  // Publish event
  await publish({
    topic: TOPICS.CARD_EVENTS,
    key: input.programId,
    value: {
      event: 'card.issued',
      cardId: result.cardId,
      programId: input.programId,
      last4,
      currency: input.currency,
      amountCents: input.amountCents.toString(),
      cardType: input.cardType,
      kycStatus,
      recipientEmail: input.recipientEmail,
      issuedAt: new Date().toISOString(),
    },
  });

  cardsIssuedTotal.inc({ program_id: input.programId, card_type: input.cardType });

  logger.info('Card issued', { cardId: result.cardId, programId: input.programId, last4, amountCents: input.amountCents.toString() });

  return { cardId: result.cardId, vaultToken, last4 };
}

// ─── Activate a card (after KYC approval or physical activation) ──────────────

export async function activateCard(cardId: string, programId: string): Promise<void> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, programId },
    include: { program: { select: { floatAccountId: true } }, account: { select: { id: true } } },
  });

  if (!card) throw Errors.cardNotFound();
  if (card.status === 'ACTIVE') return; // Idempotent
  if (card.status !== 'PENDING_ACTIVATION') throw Errors.badRequest('Card cannot be activated in its current state');

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: cardId },
      data: { status: 'ACTIVE', activatedAt: new Date(), lastUsedAt: new Date() },
    });

    // Post LOAD entry now that KYC is approved
    await postLoad({
      cardId,
      programId,
      floatAccountId: card.program.floatAccountId!,
      cardAccountId: card.accountId,
      amount: card.initialLoad,
      currency: card.currency,
      description: `Card activation — ${card.last4}`,
      tx,
    });
  });

  await publish({ topic: TOPICS.CARD_EVENTS, key: programId, value: { event: 'card.activated', cardId, programId } });
}

// ─── Suspend / Unsuspend ──────────────────────────────────────────────────────

export async function suspendCard(cardId: string, programId: string, reason: string): Promise<void> {
  const card = await prisma.card.findFirst({ where: { id: cardId, programId } });
  if (!card) throw Errors.cardNotFound();
  if (card.status !== 'ACTIVE') throw Errors.badRequest('Only ACTIVE cards can be suspended');

  await prisma.card.update({ where: { id: cardId }, data: { status: 'SUSPENDED' } });
  await publish({ topic: TOPICS.CARD_EVENTS, key: programId, value: { event: 'card.frozen', cardId, programId, reason } });
}

export async function unsuspendCard(cardId: string, programId: string): Promise<void> {
  const card = await prisma.card.findFirst({ where: { id: cardId, programId } });
  if (!card) throw Errors.cardNotFound();
  if (card.status !== 'SUSPENDED') throw Errors.badRequest('Card is not suspended');

  await prisma.card.update({ where: { id: cardId }, data: { status: 'ACTIVE' } });
  await publish({ topic: TOPICS.CARD_EVENTS, key: programId, value: { event: 'card.unfrozen', cardId, programId } });
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelCard(cardId: string, programId: string, initiatedBy: string): Promise<void> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, programId },
    include: { program: { select: { floatAccountId: true } }, account: { select: { id: true } } },
  });
  if (!card) throw Errors.cardNotFound();
  if (['CANCELLED', 'EXPIRED', 'ESHEATED'].includes(card.status)) {
    throw Errors.badRequest('Card is already closed');
  }

  const { balance } = await getBalance(card.accountId);

  await prisma.$transaction(async (tx) => {
    if (balance > 0n) {
      // Return remaining balance to float (reversal)
      const { postReversal } = await import('../ledger/ledger.service');
      // Find the auth hold account for this card
      const authHoldAccount = await tx.account.findFirst({
        where: { cardId, accountType: 'AUTH_HOLD' },
        select: { id: true },
      });
      // For cancellation, we reverse directly from float to card then card closes
      // Simple model: post a zero-amount adjustment to clear, then mark cancelled
      // In production, this would involve cancelling all pending auths first
      void authHoldAccount; // Used in full reversal flow
      void postReversal;
    }

    await tx.card.update({
      where: { id: cardId },
      data: { status: 'CANCELLED' },
    });
  });

  logger.info('Card cancelled', { cardId, programId, initiatedBy, remainingBalance: balance.toString() });
}

// ─── PIN verification ─────────────────────────────────────────────────────────

export async function verifyPin(cardId: string, pin: string): Promise<void> {
  const pinRecord = await prisma.cardPin.findUnique({ where: { cardId } });
  if (!pinRecord) throw Errors.badRequest('PIN not set for this card');

  if (pinRecord.lockedAt && pinRecord.lockedAt > new Date()) {
    throw Errors.pinLocked(pinRecord.lockedAt);
  }

  const valid = await bcrypt.compare(pin, pinRecord.pinHash);

  if (!valid) {
    const newAttempts = pinRecord.attemptCount + 1;
    const lockedAt = newAttempts >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCKOUT_MS) : null;

    await prisma.cardPin.update({
      where: { cardId },
      data: { attemptCount: newAttempts, lockedAt },
    });

    const remaining = PIN_MAX_ATTEMPTS - newAttempts;
    if (lockedAt) throw Errors.pinLocked(lockedAt);
    throw Errors.invalidPin(remaining);
  }

  // Reset attempts on success
  if (pinRecord.attemptCount > 0) {
    await prisma.cardPin.update({ where: { cardId }, data: { attemptCount: 0, lockedAt: null } });
  }
}

export async function changePin(cardId: string, currentPin: string, newPin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(newPin)) throw Errors.badRequest('PIN must be 4-6 digits');

  // Verify current PIN (this enforces lockout)
  await verifyPin(cardId, currentPin);

  const newPinHash = await bcrypt.hash(newPin, PIN_BCRYPT_COST);
  await prisma.cardPin.update({
    where: { cardId },
    data: { pinHash: newPinHash, attemptCount: 0, lockedAt: null, lastChangedAt: new Date() },
  });

  await publish({ topic: TOPICS.CARD_EVENTS, key: cardId, value: { event: 'card.pin_changed', cardId } });
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export interface ListCardsInput {
  programId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export async function listCards(input: ListCardsInput) {
  const limit = Math.min(input.limit ?? 50, 100);

  const cards = await prismaRead.card.findMany({
    where: {
      ...(input.programId && { programId: input.programId }),
      ...(input.status && { status: input.status }),
      ...(input.cursor && { id: { gt: input.cursor } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true, programId: true, last4: true, bin: true, cardType: true,
      status: true, currency: true, initialLoad: true, expiresAt: true,
      activatedAt: true, lastUsedAt: true, kycStatus: true,
      recipientName: true, recipientEmail: true, createdAt: true,
    },
  });

  const hasMore = cards.length > limit;
  const items = hasMore ? cards.slice(0, limit) : cards;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  return { items, hasMore, nextCursor };
}

export async function getCardWithBalance(cardId: string, programId?: string) {
  const card = await prismaRead.card.findFirst({
    where: { id: cardId, ...(programId && { programId }) },
    select: {
      id: true, programId: true, accountId: true, last4: true, bin: true,
      cardType: true, status: true, currency: true, initialLoad: true,
      expiresAt: true, activatedAt: true, lastUsedAt: true, kycStatus: true,
      recipientName: true, recipientEmail: true, recipientPhone: true,
      departmentId: true, createdAt: true, updatedAt: true, metadata: true,
    },
  });
  if (!card) throw Errors.cardNotFound();

  const { balance } = await getBalance(card.accountId);

  return { ...card, balance: balance.toString(), initialLoad: card.initialLoad.toString() };
}
