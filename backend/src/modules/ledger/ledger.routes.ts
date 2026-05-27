import { Router } from 'express';
import { z } from 'zod';
import { LedgerEntryType } from '@prisma/client';
import { authenticate, requireMinRole, requireFinance } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/response';
import * as ledgerService from './ledger.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';
import { balanceCheckLimiter } from '../../middleware/rateLimiter';

const router = Router();

// ─── Public balance check (card number + PIN) ─────────────────────────────────
import * as cardsService from '../cards/cards.service';

const balanceCheckSchema = z.object({
  cardNumber: z.string().regex(/^\d{16}$/),
  pin: z.string().regex(/^\d{4}$/),
});

router.post('/balance-check', balanceCheckLimiter, validate(balanceCheckSchema), async (req, res) => {
  const card = await cardsService.lookupCard(req.body.cardNumber, req.body.pin);
  const balance = await ledgerService.getBalance(card.id);
  sendSuccess(res, balance);
});

// All routes below require authentication
router.use(authenticate);

// ─── Load funds ───────────────────────────────────────────────────────────────
const loadSchema = z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
  referenceId: z.string().optional(),
  location: z.string().optional(),
});

router.post(
  '/cards/:cardId/load',
  requireFinance,
  validate(loadSchema),
  async (req: AuthenticatedRequest, res) => {
    const entry = await ledgerService.loadCard({
      cardId: req.params.cardId,
      ...req.body,
      actorId: req.user!.sub,
      ipAddress: req.ip,
    });
    sendSuccess(res, entry, 201);
  }
);

// ─── Redeem ───────────────────────────────────────────────────────────────────
const redeemSchema = z.object({
  cardNumber: z.string().regex(/^\d{16}$/),
  pin: z.string().regex(/^\d{4}$/),
  amount: z.number().positive(),
  description: z.string().optional(),
  referenceId: z.string().optional(),
  location: z.string().optional(),
});

router.post('/redeem', validate(redeemSchema), async (req: AuthenticatedRequest, res) => {
  const card = await cardsService.lookupCard(req.body.cardNumber, req.body.pin);
  const result = await ledgerService.redeemCard({
    cardId: card.id,
    amount: req.body.amount,
    description: req.body.description,
    referenceId: req.body.referenceId,
    location: req.body.location,
    ipAddress: req.ip,
    actorId: req.user?.sub,
  });
  sendSuccess(res, result);
});

// ─── Refund ───────────────────────────────────────────────────────────────────
const refundSchema = z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
  referenceId: z.string().optional(),
});

router.post(
  '/cards/:cardId/refund',
  requireFinance,
  validate(refundSchema),
  async (req: AuthenticatedRequest, res) => {
    const entry = await ledgerService.refundCard({
      cardId: req.params.cardId,
      ...req.body,
      actorId: req.user!.sub,
      ipAddress: req.ip,
    });
    sendSuccess(res, entry, 201);
  }
);

// ─── Adjustment ───────────────────────────────────────────────────────────────
const adjustSchema = z.object({
  amount: z.number(),
  description: z.string().min(1),
  referenceId: z.string().optional(),
});

router.post(
  '/cards/:cardId/adjust',
  requireMinRole(UserRole.FINANCE),
  validate(adjustSchema),
  async (req: AuthenticatedRequest, res) => {
    const entry = await ledgerService.adjustCard({
      cardId: req.params.cardId,
      ...req.body,
      actorId: req.user!.sub,
    });
    sendSuccess(res, entry, 201);
  }
);

// ─── Card-to-card transfer ────────────────────────────────────────────────────
const transferSchema = z.object({
  fromCardId: z.string().cuid(),
  toCardId: z.string().cuid(),
  amount: z.number().positive(),
  description: z.string().optional(),
  referenceId: z.string().optional(),
});

router.post(
  '/transfer',
  requireMinRole(UserRole.SUPPORT),
  validate(transferSchema),
  async (req: AuthenticatedRequest, res) => {
    const result = await ledgerService.transferBalance({
      ...req.body,
      actorId: req.user!.sub,
      ipAddress: req.ip,
    });
    sendSuccess(res, result, 201);
  }
);

// ─── Balance ──────────────────────────────────────────────────────────────────
router.get('/cards/:cardId/balance', async (req, res) => {
  const balance = await ledgerService.getBalance(req.params.cardId);
  sendSuccess(res, balance);
});

// ─── Transaction history ──────────────────────────────────────────────────────
const historySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(LedgerEntryType).optional(),
});

router.get('/cards/:cardId/transactions', validate(historySchema, 'query'), async (req, res) => {
  const result = await ledgerService.getTransactionHistory(req.params.cardId, req.query as z.infer<typeof historySchema>);
  sendSuccess(res, result.entries, 200, result.meta);
});

export default router;
