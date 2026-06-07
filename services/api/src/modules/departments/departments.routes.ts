import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';

export const departmentsRouter = Router();

const deptSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(2).max(100),
  budgetCap: z.coerce.bigint().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

function scopedProgramId(req: Request, body?: { programId?: string }): string {
  return req.user!.role === 'SUPER_ADMIN' ? (body?.programId ?? '') : req.user!.programId!;
}

// ─── List departments ─────────────────────────────────────────────────────────
departmentsRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const items = await prismaRead.department.findMany({
      where: { programId: programId ?? undefined },
      orderBy: { name: 'asc' },
      include: { _count: { select: { cards: true } } },
    });
    res.json({ data: items, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Create department ────────────────────────────────────────────────────────
departmentsRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = deptSchema.parse(req.body);
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;
    const dept = await prisma.department.create({
      data: {
        programId: input.programId,
        name: input.name,
        budgetCap: input.budgetCap ?? null,
        metadata: input.metadata as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    void writeAuditLog({ action: 'DEPARTMENT_CREATED', category: 'SYSTEM', req, resourceId: dept.id, programId: dept.programId });
    res.status(201).json({ data: dept, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get department ───────────────────────────────────────────────────────────
departmentsRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dept = await prismaRead.department.findUnique({
      where: { id: req.params['id'] as string },
      include: { _count: { select: { cards: true } } },
    });
    if (!dept) throw new AppError(404, 'NOT_FOUND', 'Department not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dept.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    res.json({ data: dept, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Update department ────────────────────────────────────────────────────────
departmentsRouter.patch('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = deptSchema.partial().parse(req.body);
    const dept = await prismaRead.department.findUnique({ where: { id: req.params['id'] as string } });
    if (!dept) throw new AppError(404, 'NOT_FOUND', 'Department not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dept.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    const updated = await prisma.department.update({
      where: { id: req.params['id'] as string },
      data: { name: input.name, budgetCap: input.budgetCap, metadata: input.metadata as unknown as import('@prisma/client').Prisma.InputJsonValue | undefined },
    });
    void writeAuditLog({ action: 'DEPARTMENT_UPDATED', category: 'SYSTEM', req, resourceId: updated.id, programId: updated.programId });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Delete department ────────────────────────────────────────────────────────
departmentsRouter.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dept = await prismaRead.department.findUnique({ where: { id: req.params['id'] as string }, select: { id: true, programId: true } });
    if (!dept) throw new AppError(404, 'NOT_FOUND', 'Department not found');
    if (req.user!.role !== 'SUPER_ADMIN' && dept.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    // Unlink cards before delete
    await prisma.card.updateMany({ where: { departmentId: dept.id }, data: { departmentId: null } });
    await prisma.department.delete({ where: { id: dept.id } });
    void writeAuditLog({ action: 'DEPARTMENT_DELETED', category: 'SYSTEM', req, resourceId: dept.id, programId: dept.programId });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
