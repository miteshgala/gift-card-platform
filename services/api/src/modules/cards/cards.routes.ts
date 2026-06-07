import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { balanceLimiter } from '../../shared/middleware/rateLimiter';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import * as cardsService from './cards.service';
import * as authorizationService from './authorization.service';

export const cardsRouter = Router();

const issueCardSchema = z.object({
  programId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  cardType: z.enum(['PHYSICAL', 'VIRTUAL', 'SINGLE_USE']).default('VIRTUAL'),
  amountCents: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  recipientName: z.string().max(100).optional(),
  recipientEmail: z.string().email().optional(),
  recipientPhone: z.string().max(20).optional(),
  recipientState: z.string().length(2).optional(),
  pin: z.string().regex(/^\d{4,6}$/),
});

const authorizeSchema = z.object({
  vaultToken: z.string().startsWith('tok_'),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  requestedAmountCents: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  merchantName: z.string().max(100).optional(),
  merchantMcc: z.string().length(4).optional(),
  merchantCountry: z.string().length(2).optional(),
  posEntryMode: z.enum(['CHIP', 'SWIPE', 'CONTACTLESS', 'ECOM', 'MANUAL']).optional(),
  retrievalRef: z.string().max(50).optional(),
  ipAddress: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

const captureSchema = z.object({
  captureAmountCents: z.coerce.bigint().positive(),
  externalRef: z.string().max(100).optional(),
});

const reversalSchema = z.object({
  reversalAmountCents: z.coerce.bigint().positive(),
});

const adjustSchema = z.object({
  amountCents: z.coerce.bigint().positive(),
  direction: z.enum(['CREDIT', 'DEBIT']),
  reason: z.string().min(10).max(500),
});

// ─── List cards ───────────────────────────────────────────────────────────────
cardsRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId ?? undefined;
    const result = await cardsService.listCards({
      programId,
      status: req.query['status'] as string | undefined,
      cursor: req.query['cursor'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    });
    res.json({ data: result.items, meta: { requestId: req.requestId, hasMore: result.hasMore, nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
});

// ─── Issue card ───────────────────────────────────────────────────────────────
cardsRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = issueCardSchema.parse(req.body);
    // Non-SUPER_ADMIN can only issue for their own program
    if (req.user!.role !== 'SUPER_ADMIN' && input.programId !== req.user!.programId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot issue cards for another program', requestId: req.requestId } });
      return;
    }
    const result = await cardsService.issueCard({ ...input, issuedBy: req.user!.id });
    void writeAuditLog({ action: 'CARD_ISSUED', category: 'CARD', req, resourceId: result.cardId, programId: input.programId, details: { cardId: result.cardId, last4: result.last4, amountCents: input.amountCents.toString() } });
    res.status(201).json({ data: result, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get card ─────────────────────────────────────────────────────────────────
cardsRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? undefined : req.user!.programId ?? undefined;
    const card = await cardsService.getCardWithBalance(req.params['id'] as string, programId);
    res.json({ data: card, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Suspend card ─────────────────────────────────────────────────────────────
cardsRouter.patch('/:id/suspend', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
    const programId = req.user!.role === 'SUPER_ADMIN' ? undefined : req.user!.programId ?? undefined;
    await cardsService.suspendCard(req.params['id'] as string, programId ?? req.body.programId, reason);
    void writeAuditLog({ action: 'CARD_SUSPENDED', category: 'CARD', req, resourceId: req.params['id'] as string, details: { reason } });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Unsuspend card ───────────────────────────────────────────────────────────
cardsRouter.patch('/:id/unsuspend', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.body.programId : req.user!.programId;
    await cardsService.unsuspendCard(req.params['id'] as string, programId);
    void writeAuditLog({ action: 'CARD_UNSUSPENDED', category: 'CARD', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Manual balance adjustment ────────────────────────────────────────────────
cardsRouter.post('/:id/adjust', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amountCents, direction, reason } = adjustSchema.parse(req.body);
    const card = await cardsService.getCardWithBalance(req.params['id'] as string);
    const { postAdjustment } = await import('../ledger/ledger.service');
    const { floatAccountId } = await (await import('../../shared/db/prisma')).prismaRead.program.findUniqueOrThrow({ where: { id: card.programId }, select: { floatAccountId: true } });
    await postAdjustment({ cardId: card.id, programId: card.programId, cardAccountId: card.accountId, floatAccountId: floatAccountId!, amount: amountCents, currency: card.currency, direction, reason, initiatedBy: req.user!.id });
    void writeAuditLog({ action: 'CARD_ADJUSTED', category: 'CARD', req, resourceId: card.id, details: { direction, amountCents: amountCents.toString(), reason } });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Cancel card ──────────────────────────────────────────────────────────────
cardsRouter.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.body.programId : req.user!.programId;
    await cardsService.cancelCard(req.params['id'] as string, programId, req.user!.id);
    void writeAuditLog({ action: 'CARD_CANCELLED', category: 'CARD', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Authorization ────────────────────────────────────────────────────────────
cardsRouter.post('/authorize', authenticate, authorize('SUPER_ADMIN', 'API_SERVICE'), idempotency, balanceLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = authorizeSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const result = await authorizationService.authorize({
      ...input,
      idempotencyKey,
      ipAddress: req.ip,
    });
    const statusCode = result.approved ? 200 : 402;
    res.status(statusCode).json({ data: result, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Capture ──────────────────────────────────────────────────────────────────
cardsRouter.post('/authorizations/:authId/capture', authenticate, authorize('SUPER_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { captureAmountCents, externalRef } = captureSchema.parse(req.body);
    await authorizationService.capture(req.params['authId'] as string, captureAmountCents, externalRef);
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Void ─────────────────────────────────────────────────────────────────────
cardsRouter.post('/authorizations/:authId/void', authenticate, authorize('SUPER_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authorizationService.voidAuthorization(req.params['authId'] as string);
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Reversal ─────────────────────────────────────────────────────────────────
cardsRouter.post('/authorizations/:authId/reverse', authenticate, authorize('SUPER_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reversalAmountCents } = reversalSchema.parse(req.body);
    await authorizationService.reverseAuthorization(req.params['authId'] as string, reversalAmountCents);
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
