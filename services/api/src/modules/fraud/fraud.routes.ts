/**
 * Fraud Admin Routes
 * Manage velocity rules, fraud flags, and SAR filings.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';

export const fraudRouter = Router();

const velocityRuleSchema = z.object({
  programId: z.string().uuid().optional(),
  name: z.string().min(3).max(120),
  scope: z.enum(['CARD', 'BIN', 'MERCHANT', 'IP', 'DEVICE']),
  windowSeconds: z.number().int().positive(),
  maxCount: z.number().int().positive().optional(),
  maxAmount: z.coerce.bigint().positive().optional(),
  action: z.enum(['FLAG', 'DECLINE', 'SUSPEND']).default('FLAG'),
  priority: z.number().int().min(0).max(100).default(50),
  enabled: z.boolean().default(true),
});

const sarSchema = z.object({
  programId: z.string().uuid(),
  cardId: z.string().uuid().optional(),
  filingType: z.enum(['SAR', 'CTR']),
  triggerEvent: z.string().min(10).max(500),
  amount: z.coerce.bigint().positive().optional(),
  currency: z.string().length(3).optional(),
});

// ─── Velocity rules ───────────────────────────────────────────────────────────

fraudRouter.get('/velocity-rules', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const rules = await prismaRead.velocityRule.findMany({
      where: { programId: programId ?? undefined },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ data: rules, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.post('/velocity-rules', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = velocityRuleSchema.parse(req.body);
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;
    const rule = await prisma.velocityRule.create({ data: { ...input, maxAmount: input.maxAmount ?? null } });
    void writeAuditLog({ action: 'VELOCITY_RULE_CREATED', category: 'FRAUD', req, resourceId: rule.id, programId: rule.programId ?? undefined });
    res.status(201).json({ data: rule, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.patch('/velocity-rules/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = velocityRuleSchema.partial().parse(req.body);
    const rule = await prismaRead.velocityRule.findUnique({ where: { id: req.params['id'] as string } });
    if (!rule) throw new AppError(404, 'NOT_FOUND', 'Velocity rule not found');
    if (req.user!.role !== 'SUPER_ADMIN' && rule.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    const updated = await prisma.velocityRule.update({ where: { id: rule.id }, data: input });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.delete('/velocity-rules/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await prismaRead.velocityRule.findUnique({ where: { id: req.params['id'] as string } });
    if (!rule) throw new AppError(404, 'NOT_FOUND', 'Velocity rule not found');
    if (req.user!.role !== 'SUPER_ADMIN' && rule.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    await prisma.velocityRule.delete({ where: { id: rule.id } });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Fraud flags ──────────────────────────────────────────────────────────────

fraudRouter.get('/flags', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const limit = Math.min(Number(req.query['limit'] ?? 20), 100);
    const flags = await prismaRead.fraudFlag.findMany({
      where: {
        programId: programId ?? undefined,
        status: req.query['status'] as string | undefined,
        severity: req.query['severity'] as string | undefined,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { card: { select: { id: true, last4: true, vaultToken: true } } },
    });
    res.json({ data: flags, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.patch('/flags/:id/resolve', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, resolutionNote } = z.object({
      status: z.enum(['RESOLVED', 'FALSE_POSITIVE']),
      resolutionNote: z.string().min(10).max(500),
    }).parse(req.body);

    const flag = await prismaRead.fraudFlag.findUnique({ where: { id: req.params['id'] as string } });
    if (!flag) throw new AppError(404, 'NOT_FOUND', 'Fraud flag not found');
    if (req.user!.role !== 'SUPER_ADMIN' && flag.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    if (flag.status !== 'OPEN') throw new AppError(422, 'INVALID_STATE', 'Flag is already resolved');

    const updated = await prisma.fraudFlag.update({
      where: { id: flag.id },
      data: { status, resolvedBy: req.user!.id, resolvedAt: new Date(), resolutionNote },
    });
    void writeAuditLog({ action: 'FRAUD_FLAG_RESOLVED', category: 'FRAUD', req, resourceId: flag.id, programId: flag.programId, details: { status, resolutionNote } });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── SAR / CTR filings ────────────────────────────────────────────────────────

fraudRouter.get('/sar-filings', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const filings = await prismaRead.sarFiling.findMany({
      where: { programId: programId ?? undefined },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ data: filings, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.post('/sar-filings', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = sarSchema.parse(req.body);
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;
    const filing = await prisma.sarFiling.create({
      data: {
        programId: input.programId,
        cardId: input.cardId ?? null,
        filingType: input.filingType,
        triggerEvent: input.triggerEvent,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        status: 'DRAFT',
        createdBy: req.user!.id,
      },
    });
    void writeAuditLog({ action: 'SAR_FILING_CREATED', category: 'FRAUD', req, resourceId: filing.id, programId: filing.programId, details: { filingType: input.filingType } });
    res.status(201).json({ data: filing, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

fraudRouter.patch('/sar-filings/:id/submit', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fincenRef } = z.object({ fincenRef: z.string().min(3).max(100).optional() }).parse(req.body);
    const filing = await prismaRead.sarFiling.findUnique({ where: { id: req.params['id'] as string } });
    if (!filing) throw new AppError(404, 'NOT_FOUND', 'Filing not found');
    if (filing.status !== 'DRAFT') throw new AppError(422, 'INVALID_STATE', 'Only DRAFT filings can be submitted');
    const updated = await prisma.sarFiling.update({
      where: { id: filing.id },
      data: { status: 'SUBMITTED', fincenRef: fincenRef ?? null, filedAt: new Date() },
    });
    void writeAuditLog({ action: 'SAR_FILING_SUBMITTED', category: 'FRAUD', req, resourceId: filing.id, programId: filing.programId });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
