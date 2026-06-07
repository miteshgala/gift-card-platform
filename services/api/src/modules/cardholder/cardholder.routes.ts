/**
 * Cardholder Portal Routes
 * Public-facing endpoints for cardholders to check balance, view history,
 * submit disputes, manage digital wallets, and reload via Stripe.
 *
 * Authentication: JWT issued by cardholder login (uses vaultToken + PIN as credentials).
 * No admin auth required — these are consumer-facing endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { getBalance } from '../ledger/ledger.service';
import { redis } from '../../shared/redis/client';
import { env } from '../../shared/utils/env';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const cardholderRouter = Router();

// ─── Rate limiter for cardholder endpoints ────────────────────────────────────
async function cardholderRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = `ratelimit:cardholder:${req.ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  if (count > 60) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  }
  next();
}

// ─── Cardholder authentication middleware ─────────────────────────────────────
interface CardholderTokenPayload {
  sub: string;   // card ID
  vaultToken: string;
  programId: string;
}

function authenticateCardholder(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization token' } });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as CardholderTokenPayload;
    (req as Request & { card: CardholderTokenPayload }).card = payload;
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

// ─── POST /cardholder/auth ─── Cardholder login ───────────────────────────────
cardholderRouter.post('/auth', cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cardNumber, pin } = z.object({
      cardNumber: z.string().regex(/^\d{16}$/),
      pin: z.string().regex(/^\d{4,6}$/),
    }).parse(req.body);

    // Look up card by last 4 digits — in production, tokenize the card number via vault
    const last4 = cardNumber.slice(-4);
    const cards = await prismaRead.card.findMany({
      where: { last4, status: 'ACTIVE' },
      include: { pin: true },
    });

    // Find the card by vault token match (in production, we'd call vault.tokenize)
    // For now, we find by last4 and validate PIN
    let matchedCard = null;
    for (const card of cards) {
      if (card.pin && await bcrypt.compare(pin, card.pin.pinHash)) {
        matchedCard = card;
        break;
      }
    }

    if (!matchedCard) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid card number or PIN' } });
    }

    // Issue a short-lived cardholder JWT (1 hour)
    const payload: CardholderTokenPayload = {
      sub: matchedCard.id,
      vaultToken: matchedCard.vaultToken,
      programId: matchedCard.programId,
    };

    const token = jwt.sign(payload, env.JWT_PRIVATE_KEY, {
      algorithm: 'RS256',
      expiresIn: '1h',
      issuer: 'giftcard-cardholder',
    });

    res.json({ data: { accessToken: token, cardId: matchedCard.id, last4: matchedCard.last4 }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── GET /cardholder/balance ──────────────────────────────────────────────────
cardholderRouter.get('/balance', authenticateCardholder, cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const card = await prismaRead.card.findUnique({
      where: { id: cardInfo.sub },
      select: { id: true, accountId: true, currency: true, status: true, expiresAt: true, last4: true },
    });
    if (!card || card.status !== 'ACTIVE') throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found or inactive');

    const balanceResult = await getBalance(card.accountId);

    res.json({
      data: {
        cardId: card.id,
        last4: card.last4,
        balanceCents: balanceResult.balance.toString(),
        currency: balanceResult.currency,
        expiresAt: card.expiresAt,
        status: card.status,
      },
      meta: { requestId: req.requestId },
    });
  } catch (err) { next(err); }
});

// ─── GET /cardholder/transactions ────────────────────────────────────────────
cardholderRouter.get('/transactions', authenticateCardholder, cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const limit = Math.min(Number(req.query['limit'] ?? 20), 50);
    const cursor = req.query['cursor'] as string | undefined;

    const card = await prismaRead.card.findUnique({
      where: { id: cardInfo.sub },
      select: { accountId: true },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');

    const lines = await prismaRead.journalLine.findMany({
      where: { accountId: card.accountId },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        entry: {
          select: {
            id: true, entryType: true, description: true, postedAt: true,
            authorization: { select: { merchantName: true, merchantMcc: true, merchantCountry: true } },
          },
        },
      },
    });

    const hasMore = lines.length > limit;
    const items = (hasMore ? lines.slice(0, limit) : lines).map((line) => ({
      id: line.id,
      entryId: line.entryId,
      entryType: line.entry.entryType,
      description: line.entry.description,
      direction: line.direction,
      amountCents: line.amount.toString(),
      currency: line.currency,
      merchantName: line.entry.authorization?.merchantName ?? null,
      merchantMcc: line.entry.authorization?.merchantMcc ?? null,
      merchantCountry: line.entry.authorization?.merchantCountry ?? null,
      postedAt: line.entry.postedAt,
    }));

    res.json({ data: items, meta: { requestId: req.requestId, hasMore, nextCursor: hasMore ? items[items.length - 1]?.id : undefined } });
  } catch (err) { next(err); }
});

// ─── GET /cardholder/authorizations ──────────────────────────────────────────
cardholderRouter.get('/authorizations', authenticateCardholder, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const auths = await prismaRead.authorization.findMany({
      where: { cardId: cardInfo.sub, status: 'PENDING' },
      select: {
        id: true, requestedAmount: true, authorizedAmount: true, capturedAmount: true,
        currency: true, merchantName: true, merchantMcc: true, status: true, expiresAt: true, authorizedAt: true,
      },
      orderBy: { authorizedAt: 'desc' },
      take: 20,
    });
    res.json({ data: auths, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── POST /cardholder/disputes ────────────────────────────────────────────────
cardholderRouter.post('/disputes', authenticateCardholder, cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const input = z.object({
      authorizationId: z.string().uuid().optional(),
      disputeType: z.enum(['UNAUTHORIZED', 'ITEM_NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DUPLICATE', 'CREDIT_NOT_PROCESSED', 'OTHER']),
      amount: z.coerce.bigint().positive(),
      currency: z.string().length(3),
      description: z.string().min(10).max(2000),
    }).parse(req.body);

    const dispute = await prisma.dispute.create({
      data: {
        cardId: cardInfo.sub,
        authorizationId: input.authorizationId ?? null,
        programId: cardInfo.programId,
        disputeType: input.disputeType,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        evidenceS3Keys: [],
        status: 'SUBMITTED',
      },
    });
    res.status(201).json({ data: { disputeId: dispute.id, status: dispute.status }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── POST /cardholder/reload/intent ── Stripe PaymentIntent ──────────────────
cardholderRouter.post('/reload/intent', authenticateCardholder, cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const { amountCents, currency } = z.object({
      amountCents: z.coerce.bigint().positive().refine((v) => v >= 500n && v <= 100000n, 'Amount must be $5–$1,000'),
      currency: z.string().length(3),
    }).parse(req.body);

    const card = await prismaRead.card.findUnique({
      where: { id: cardInfo.sub },
      select: { id: true, status: true, last4: true },
    });
    if (!card || card.status !== 'ACTIVE') throw new AppError(422, 'CARD_INACTIVE', 'Card is not active');

    const stripe = await import('stripe').then((m) => new m.default(env.STRIPE_SECRET_KEY));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amountCents),
      currency: currency.toLowerCase(),
      metadata: { cardId: card.id, last4: card.last4 },
      automatic_payment_methods: { enabled: true },
    });

    // Store the pending reload
    await prisma.pendingReload.create({
      data: {
        cardId: card.id,
        amount: amountCents,
        currency,
        stripePaymentIntentId: paymentIntent.id,
        status: 'PENDING',
      },
    });

    res.json({ data: { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── POST /cardholder/reload/webhook ── Stripe webhook ───────────────────────
// This endpoint is called by Stripe after payment — not by cardholders
cardholderRouter.post('/reload/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature' });

    const stripe = await import('stripe').then((m) => new m.default(env.STRIPE_SECRET_KEY));
    const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody!, sig, WEBHOOK_SECRET);
    } catch {
      return res.status(400).json({ error: 'Invalid stripe signature' });
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as { id: string };
      const pending = await prismaRead.pendingReload.findUnique({
        where: { stripePaymentIntentId: pi.id },
        include: { card: { select: { id: true, accountId: true, programId: true, currency: true } } },
      });

      if (pending && pending.status === 'PENDING' && pending.card) {
        const program = await prismaRead.program.findUniqueOrThrow({
          where: { id: pending.card.programId },
          select: { floatAccountId: true },
        });

        if (program.floatAccountId) {
          const { postReload } = await import('../ledger/ledger.service');
          await postReload({
            cardId: pending.card.id,
            programId: pending.card.programId,
            cardAccountId: pending.card.accountId,
            floatAccountId: program.floatAccountId,
            amount: pending.amount,
            currency: pending.currency,
            stripePaymentIntentId: pi.id,
          });

          await prisma.pendingReload.update({
            where: { id: pending.id },
            data: { status: 'COMPLETED' },
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) { next(err); }
});

// ─── GET /cardholder/card ─────────────────────────────────────────────────────
cardholderRouter.get('/card', authenticateCardholder, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const card = await prismaRead.card.findUnique({
      where: { id: cardInfo.sub },
      select: {
        id: true, last4: true, bin: true, cardType: true, status: true,
        currency: true, expiresAt: true, activatedAt: true, recipientName: true,
        recipientEmail: true, kycStatus: true, createdAt: true,
      },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    res.json({ data: card, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── POST /cardholder/pin/change ──────────────────────────────────────────────
cardholderRouter.post('/pin/change', authenticateCardholder, cardholderRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cardInfo = (req as Request & { card: CardholderTokenPayload }).card;
    const { currentPin, newPin } = z.object({
      currentPin: z.string().regex(/^\d{4,6}$/),
      newPin: z.string().regex(/^\d{4,6}$/),
    }).parse(req.body);

    const cardPin = await prismaRead.cardPin.findUnique({ where: { cardId: cardInfo.sub } });
    if (!cardPin) throw new AppError(404, 'PIN_NOT_FOUND', 'Card PIN not set');

    if (cardPin.lockedAt && new Date() < new Date(cardPin.lockedAt.getTime() + 30 * 60 * 1000)) {
      throw new AppError(423, 'PIN_LOCKED', 'PIN is temporarily locked');
    }

    const valid = await bcrypt.compare(currentPin, cardPin.pinHash);
    if (!valid) {
      const newAttempts = cardPin.attemptCount + 1;
      const lockAt = newAttempts >= 5 ? new Date() : null;
      await prisma.cardPin.update({
        where: { cardId: cardInfo.sub },
        data: { attemptCount: newAttempts, lockedAt: lockAt },
      });
      throw new AppError(401, 'INVALID_PIN', 'Current PIN is incorrect');
    }

    const newHash = await bcrypt.hash(newPin, 12);
    await prisma.cardPin.update({
      where: { cardId: cardInfo.sub },
      data: { pinHash: newHash, attemptCount: 0, lockedAt: null, lastChangedAt: new Date() },
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
