/**
 * Disputes Routes
 * Cardholder dispute management with provisional credit.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { postDisputeCredit, postDisputeReversal } from '../ledger/ledger.service';

export const disputesRouter = Router();

const createDisputeSchema = z.object({
  cardId: z.string().uuid(),
  authorizationId: z.string().uuid().optional(),
  disputeType: z.enum(['UNAUTHORIZED', 'ITEM_NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DUPLICATE', 'CREDIT_NOT_PROCESSED', 'OTHER']),
  amount: z.coerce.bigint().positive(),
  currency: z.string().length(3),
  description: z.string().min(10).max(2000),
});

const resolveSchema = z.object({
  outcome: z.enum(['WON', 'LOST', 'WITHDRAWN']),
  resolution: z.string().min(10).max(1000),
  reclaimProvisionalCredit: z.boolean().default(false),
});

// ─── List disputes ────────────────────────────────────────────────────────────
disputesRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const limit = Math.min(Number(req.query['limit'] ?? 20), 100);
    const disputes = await prismaRead.dispute.findMany({
      where: {
        programId: programId ?? undefined,
        status: req.query['status'] as string | undefined,
        cardId: req.query['cardId'] as string | undefined,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        card: { select: { id: true, last4: true, recipientName: true } },
      },
    });
    res.json({ data: disputes, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Create dispute ───────────────────────────────────────────────────────────
disputesRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createDisputeSchema.parse(req.body);

    const card = await prismaRead.card.findUnique({
      where: { id: input.cardId },
      select: { id: true, programId: true, accountId: true, currency: true, status: true },
    });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    if (req.user!.role !== 'SUPER_ADMIN' && card.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    if (card.status === 'CANCELLED') throw new AppError(422, 'CARD_CANCELLED', 'Cannot dispute on a cancelled card');

    const dispute = await prisma.dispute.create({
      data: {
        cardId: input.cardId,
        authorizationId: input.authorizationId ?? null,
        programId: card.programId,
        disputeType: input.disputeType,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        evidenceS3Keys: [],
        status: 'SUBMITTED',
      },
    });

    void writeAuditLog({ action: 'DISPUTE_CREATED', category: 'CARD', req, resourceId: dispute.id, programId: dispute.programId, details: { disputeType: input.disputeType, amount: input.amount.toString() } });
    res.status(201).json({ data: dispute, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get dispute ──────────────────────────────────────────────────────────────
disputesRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dispute = await prismaRead.dispute.findUnique({
      where: { id: req.params['id'] as string },
      include: { card: { select: { id: true, last4: true, recipientName: true } } },
    });
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dispute.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    res.json({ data: dispute, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Issue provisional credit ─────────────────────────────────────────────────
disputesRouter.post('/:id/provisional-credit', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dispute = await prismaRead.dispute.findUnique({
      where: { id: req.params['id'] as string },
      include: { card: { select: { id: true, accountId: true, programId: true } } },
    });
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dispute.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    if (dispute.status !== 'SUBMITTED' && dispute.status !== 'UNDER_REVIEW') throw new AppError(422, 'INVALID_STATE', 'Invalid dispute status for provisional credit');
    if (dispute.provisionalCreditEntryId) throw new AppError(422, 'ALREADY_CREDITED', 'Provisional credit already issued');

    const program = await prismaRead.program.findUniqueOrThrow({
      where: { id: dispute.programId },
      select: { floatAccountId: true },
    });
    if (!program.floatAccountId) throw new AppError(422, 'NO_FLOAT', 'Program float account not configured');

    const entry = await postDisputeCredit({
      disputeId: dispute.id,
      programId: dispute.programId,
      cardAccountId: dispute.card!.accountId,
      floatAccountId: program.floatAccountId,
      amount: dispute.amount,
      currency: dispute.currency,
    });

    await prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: 'PROVISIONAL_CREDIT_ISSUED', provisionalCreditEntryId: entry.entryId },
    });

    void writeAuditLog({ action: 'DISPUTE_PROVISIONAL_CREDIT', category: 'LEDGER', req, resourceId: dispute.id, programId: dispute.programId, details: { amount: dispute.amount.toString() } });
    res.json({ data: { success: true, entryId: entry.entryId }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Resolve dispute ──────────────────────────────────────────────────────────
disputesRouter.patch('/:id/resolve', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = resolveSchema.parse(req.body);
    const dispute = await prismaRead.dispute.findUnique({
      where: { id: req.params['id'] as string },
      include: { card: { select: { id: true, accountId: true } } },
    });
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dispute.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    if (!['SUBMITTED', 'UNDER_REVIEW', 'PROVISIONAL_CREDIT_ISSUED'].includes(dispute.status)) {
      throw new AppError(422, 'INVALID_STATE', 'Dispute is already resolved');
    }

    let resolutionEntryId: string | undefined;

    // If provisional credit was issued and we need to reclaim it (dispute LOST)
    if (input.outcome === 'LOST' && dispute.provisionalCreditEntryId && input.reclaimProvisionalCredit) {
      const program = await prismaRead.program.findUniqueOrThrow({
        where: { id: dispute.programId },
        select: { floatAccountId: true },
      });
      if (program.floatAccountId) {
        const entry = await postDisputeReversal({
          disputeId: dispute.id,
          programId: dispute.programId,
          cardAccountId: dispute.card!.accountId,
          floatAccountId: program.floatAccountId,
          amount: dispute.amount,
          currency: dispute.currency,
        });
        resolutionEntryId = entry.entryId;
      }
    }

    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: input.outcome,
        resolution: input.resolution,
        resolvedAt: new Date(),
        resolutionEntryId: resolutionEntryId ?? null,
      },
    });

    void writeAuditLog({ action: 'DISPUTE_RESOLVED', category: 'CARD', req, resourceId: dispute.id, programId: dispute.programId, details: { outcome: input.outcome } });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Assign dispute ───────────────────────────────────────────────────────────
disputesRouter.patch('/:id/assign', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignedTo } = z.object({ assignedTo: z.string().uuid() }).parse(req.body);
    const dispute = await prismaRead.dispute.findUnique({ where: { id: req.params['id'] as string } });
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dispute.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { assignedTo, status: dispute.status === 'SUBMITTED' ? 'UNDER_REVIEW' : dispute.status },
    });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
