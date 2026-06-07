/**
 * Settlement Routes
 * Settlement runs, party management, and GL export.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { getBalance } from '../ledger/ledger.service';

export const settlementRouter = Router();

const createRunSchema = z.object({
  programId: z.string().uuid(),
  partyId: z.string().uuid(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  currency: z.string().length(3),
});

const partySchema = z.object({
  partyType: z.enum(['FRANCHISEE', 'COALITION_BRAND', 'MARKETPLACE_SELLER', 'DISTRIBUTOR', 'WHITE_LABEL_CLIENT', 'PROGRAM_OWNER']),
  name: z.string().min(2).max(120),
  legalName: z.string().min(2).max(200),
  settlementCurrency: z.string().length(3).default('USD'),
  settlementFrequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).default('WEEKLY'),
  metadata: z.record(z.unknown()).default({}),
});

// ─── Settlement parties ────────────────────────────────────────────────────────

settlementRouter.get('/parties', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parties = await prismaRead.settlementParty.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    res.json({ data: parties, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

settlementRouter.post('/parties', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = partySchema.parse(req.body);
    const party = await prisma.settlementParty.create({
      data: { ...input, metadata: input.metadata as unknown as import('@prisma/client').Prisma.InputJsonValue, status: 'ACTIVE' },
    });
    void writeAuditLog({ action: 'SETTLEMENT_PARTY_CREATED', category: 'SYSTEM', req, resourceId: party.id });
    res.status(201).json({ data: party, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Settlement runs ───────────────────────────────────────────────────────────

settlementRouter.get('/runs', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const runs = await prismaRead.settlementRun.findMany({
      where: { programId: programId ?? undefined, status: req.query['status'] as string | undefined },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { party: { select: { id: true, name: true } } },
    });
    res.json({ data: runs, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

settlementRouter.post('/runs', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createRunSchema.parse(req.body);
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;

    // Calculate gross redemptions for the period
    const captures = await prismaRead.authorization.findMany({
      where: {
        programId: input.programId,
        status: { in: ['CAPTURED', 'PARTIALLY_CAPTURED'] },
        capturedAt: { gte: input.periodStart, lte: input.periodEnd },
      },
      select: { capturedAmount: true, id: true },
    });

    const grossRedemptions = captures.reduce((s, a) => s + a.capturedAmount, 0n);
    const feesWithheld = (grossRedemptions * 2n) / 100n; // 2% fee
    const netPayable = grossRedemptions - feesWithheld;

    const run = await prisma.settlementRun.create({
      data: {
        programId: input.programId,
        partyId: input.partyId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency,
        status: 'READY',
        grossRedemptions,
        feesWithheld,
        netPayable,
        lines: {
          createMany: {
            data: captures.map((c) => ({
              authorizationId: c.id,
              amount: c.capturedAmount,
              currency: input.currency,
              lineType: 'REDEMPTION',
            })),
          },
        },
      },
    });

    void writeAuditLog({
      action: 'SETTLEMENT_RUN_CREATED', category: 'LEDGER', req,
      resourceId: run.id, programId: run.programId,
      details: { grossRedemptions: grossRedemptions.toString(), netPayable: netPayable.toString() },
    });
    res.status(201).json({ data: run, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

settlementRouter.get('/runs/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prismaRead.settlementRun.findUnique({
      where: { id: req.params['id'] as string },
      include: { party: true, lines: { take: 100 } },
    });
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Settlement run not found');
    if (req.user!.role !== 'SUPER_ADMIN' && run.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    res.json({ data: run, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

settlementRouter.patch('/runs/:id/approve', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prismaRead.settlementRun.findUnique({ where: { id: req.params['id'] as string } });
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Settlement run not found');
    if (run.status !== 'READY') throw new AppError(422, 'INVALID_STATE', 'Run must be in READY status to approve');
    if (req.user!.role !== 'SUPER_ADMIN' && run.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

    const updated = await prisma.settlementRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: new Date() },
    });
    void writeAuditLog({ action: 'SETTLEMENT_RUN_APPROVED', category: 'LEDGER', req, resourceId: run.id, programId: run.programId });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

settlementRouter.patch('/runs/:id/mark-paid', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentRef } = z.object({ paymentRef: z.string().min(3).max(100) }).parse(req.body);
    const run = await prismaRead.settlementRun.findUnique({ where: { id: req.params['id'] as string } });
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Settlement run not found');
    if (run.status !== 'APPROVED') throw new AppError(422, 'INVALID_STATE', 'Run must be APPROVED before marking as paid');

    const updated = await prisma.settlementRun.update({
      where: { id: run.id },
      data: { status: 'PAID', paymentRef, paidAt: new Date() },
    });
    void writeAuditLog({ action: 'SETTLEMENT_RUN_PAID', category: 'LEDGER', req, resourceId: run.id, programId: run.programId, details: { paymentRef } });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
