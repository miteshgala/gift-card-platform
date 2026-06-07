import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, scopeToProgram } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import * as programsService from './programs.service';

export const programsRouter = Router();

const createProgramSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(60),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  currency: z.string().length(3).default('USD'),
  openLoop: z.boolean().default(false),
  cardExpiryDays: z.number().int().min(365).max(3650).default(1825),
  dormancyFeeCents: z.coerce.bigint().nonnegative().default(0n),
  dormancyMonths: z.number().int().min(12).max(36).default(12),
  budgetCap: z.coerce.bigint().positive().optional(),
  approvalThreshold: z.coerce.bigint().positive().default(500000n),
  autoApproveLimit: z.coerce.bigint().positive().default(100000n),
  kycRequiredAbove: z.coerce.bigint().positive().optional(),
  ownerPartyId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateProgramSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  dormancyFeeCents: z.coerce.bigint().nonnegative().optional(),
  dormancyMonths: z.number().int().min(12).max(36).optional(),
  budgetCap: z.coerce.bigint().positive().optional(),
  approvalThreshold: z.coerce.bigint().positive().optional(),
  autoApproveLimit: z.coerce.bigint().positive().optional(),
  kycRequiredAbove: z.coerce.bigint().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── List programs ────────────────────────────────────────────────────────────
programsRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Non-SUPER_ADMIN: scope to their program only
    if (req.user!.role !== 'SUPER_ADMIN') {
      const program = await programsService.getProgram(req.user!.programId!);
      return res.json({ data: [program], meta: { requestId: req.requestId } });
    }
    const result = await programsService.listPrograms({
      status: req.query['status'] as string | undefined,
      cursor: req.query['cursor'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    });
    res.json({ data: result.items, meta: { requestId: req.requestId, hasMore: result.hasMore, nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
});

// ─── Create program ───────────────────────────────────────────────────────────
programsRouter.post('/', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createProgramSchema.parse(req.body);
    const program = await programsService.createProgram(input);
    void writeAuditLog({ action: 'PROGRAM_CREATED', category: 'SYSTEM', req, resourceId: program.id, programId: program.id, details: { slug: program.slug } });
    res.status(201).json({ data: program, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get program ──────────────────────────────────────────────────────────────
programsRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT', 'AUDITOR'), scopeToProgram, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const program = await programsService.getProgram(req.params['id'] as string);
    res.json({ data: program, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Update program ───────────────────────────────────────────────────────────
programsRouter.patch('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), scopeToProgram, idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateProgramSchema.parse(req.body);
    const program = await programsService.updateProgram(req.params['id'] as string, input);
    void writeAuditLog({ action: 'PROGRAM_UPDATED', category: 'SYSTEM', req, resourceId: req.params['id'] as string, programId: req.params['id'] as string, details: input as Record<string, unknown> });
    res.json({ data: program, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Suspend program ──────────────────────────────────────────────────────────
programsRouter.patch('/:id/suspend', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await programsService.suspendProgram(req.params['id'] as string);
    void writeAuditLog({ action: 'PROGRAM_SUSPENDED', category: 'SYSTEM', req, resourceId: req.params['id'] as string, programId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Activate program ─────────────────────────────────────────────────────────
programsRouter.patch('/:id/activate', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await programsService.activateProgram(req.params['id'] as string);
    void writeAuditLog({ action: 'PROGRAM_ACTIVATED', category: 'SYSTEM', req, resourceId: req.params['id'] as string, programId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Reconciliation history ───────────────────────────────────────────────────
programsRouter.get('/:id/reconciliation', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), scopeToProgram, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await programsService.getProgramReconciliation(req.params['id'] as string);
    res.json({ data: logs, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
