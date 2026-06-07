/**
 * Audit Log Routes
 * Read-only access to the immutable audit trail.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { prismaRead } from '../../shared/db/prisma';

export const auditLogRouter = Router();

const querySchema = z.object({
  programId: z.string().uuid().optional(),
  category: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
  resourceId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

// ─── List audit logs ──────────────────────────────────────────────────────────
auditLogRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = querySchema.parse(req.query);
    const programId = req.user!.role === 'SUPER_ADMIN' ? input.programId : req.user!.programId!;

    const logs = await prismaRead.auditLog.findMany({
      where: {
        programId: programId ?? undefined,
        category: input.category ?? undefined,
        action: input.action ?? undefined,
        actorId: input.actorId ?? undefined,
        resourceId: input.resourceId ?? undefined,
        createdAt: {
          gte: input.startDate,
          lte: input.endDate,
        },
      },
      take: input.limit + 1,
      cursor: input.cursor ? { id: input.cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, action: true, category: true, actorId: true, actorEmail: true,
        resourceType: true, resourceId: true, programId: true, ipAddress: true,
        details: true, requestId: true, createdAt: true,
      },
    });

    const hasMore = logs.length > input.limit;
    const items = hasMore ? logs.slice(0, input.limit) : logs;

    res.json({
      data: items,
      meta: { requestId: req.requestId, hasMore, nextCursor: hasMore ? items[items.length - 1]?.id : undefined },
    });
  } catch (err) { next(err); }
});

// ─── Get single audit log entry ───────────────────────────────────────────────
auditLogRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = await prismaRead.auditLog.findUnique({ where: { id: req.params['id'] as string } });
    if (!log) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Audit log entry not found' } });
    // Scope check for non-super-admin
    if (req.user!.role !== 'SUPER_ADMIN' && log.programId !== req.user!.programId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    res.json({ data: log, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
