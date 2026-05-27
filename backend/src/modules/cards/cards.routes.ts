import { Router } from 'express';
import { z } from 'zod';
import { CardStatus, CardType } from '@prisma/client';
import { authenticate, requireMinRole, requireSupport } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as cardsService from './cards.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// ─── Issue single card ────────────────────────────────────────────────────────
const issueSchema = z.object({
  programId: z.string().cuid(),
  campaignId: z.string().cuid().optional(),
  cardType: z.nativeEnum(CardType).default(CardType.DIGITAL),
  denomination: z.number().positive().optional(),
  initialBalance: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
  expiryDays: z.number().int().positive().optional(),
});

router.post(
  '/',
  requireMinRole(UserRole.MARKETING),
  validate(issueSchema),
  async (req: AuthenticatedRequest, res) => {
    const result = await cardsService.issueCard(req.body);
    sendCreated(res, result);
  }
);

// ─── List cards ───────────────────────────────────────────────────────────────
const listSchema = z.object({
  programId: z.string().cuid().optional(),
  status: z.nativeEnum(CardStatus).optional(),
  cardType: z.nativeEnum(CardType).optional(),
  recipientEmail: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  '/',
  validate(listSchema, 'query'),
  async (req: AuthenticatedRequest, res) => {
    const filters = req.query as z.infer<typeof listSchema>;
    // Non-super-admins can only see their program's cards
    if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.programId) {
      filters.programId = req.user.programId;
    }
    const result = await cardsService.listCards(filters);
    sendSuccess(res, result.cards, 200, result.meta);
  }
);

// ─── Get card by ID ───────────────────────────────────────────────────────────
router.get('/:cardId', async (req: AuthenticatedRequest, res) => {
  const programId = req.user?.role !== UserRole.SUPER_ADMIN ? req.user?.programId : undefined;
  const card = await cardsService.getCardById(req.params.cardId, programId);
  sendSuccess(res, card);
});

// ─── Activate physical card ───────────────────────────────────────────────────
const activateSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

router.post(
  '/:cardId/activate',
  validate(activateSchema),
  async (req: AuthenticatedRequest, res) => {
    const card = await cardsService.activateCard(req.params.cardId, req.body.pin, req.user!.sub);
    sendSuccess(res, card);
  }
);

// ─── Freeze ───────────────────────────────────────────────────────────────────
const freezeSchema = z.object({ reason: z.string().min(1) });

router.post(
  '/:cardId/freeze',
  requireSupport,
  validate(freezeSchema),
  async (req: AuthenticatedRequest, res) => {
    const card = await cardsService.freezeCard(req.params.cardId, req.body.reason, req.user!.sub);
    sendSuccess(res, card);
  }
);

// ─── Unfreeze ─────────────────────────────────────────────────────────────────
router.post(
  '/:cardId/unfreeze',
  requireSupport,
  async (req: AuthenticatedRequest, res) => {
    const card = await cardsService.unfreezeCard(req.params.cardId, req.user!.sub);
    sendSuccess(res, card);
  }
);

// ─── Cancel ───────────────────────────────────────────────────────────────────
const cancelSchema = z.object({ reason: z.string().min(1) });

router.post(
  '/:cardId/cancel',
  requireMinRole(UserRole.PROGRAM_ADMIN),
  validate(cancelSchema),
  async (req: AuthenticatedRequest, res) => {
    const card = await cardsService.cancelCard(req.params.cardId, req.body.reason, req.user!.sub);
    sendSuccess(res, card);
  }
);

export default router;
