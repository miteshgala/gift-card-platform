import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import * as ordersService from './orders.service';

export const ordersRouter = Router();

const lineItemSchema = z.object({
  recipientName: z.string().max(100).optional(),
  recipientEmail: z.string().email().optional(),
  recipientPhone: z.string().max(20).optional(),
  amountCents: z.coerce.bigint().positive(),
  cardType: z.enum(['PHYSICAL', 'VIRTUAL', 'SINGLE_USE']).default('VIRTUAL'),
});

const createOrderSchema = z.object({
  programId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  currency: z.string().length(3),
  lineItems: z.array(lineItemSchema).min(1).max(10000),
  metadata: z.record(z.unknown()).default({}),
});

// ─── List orders ──────────────────────────────────────────────────────────────
ordersRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const result = await ordersService.listOrders(programId, {
      status: req.query['status'] as string | undefined,
      cursor: req.query['cursor'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    });
    res.json({ data: result.items, meta: { requestId: req.requestId, hasMore: result.hasMore, nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
});

// ─── Create order ─────────────────────────────────────────────────────────────
ordersRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createOrderSchema.parse(req.body);
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;
    const order = await ordersService.createOrder({ ...input, createdBy: req.user!.id });
    void writeAuditLog({
      action: 'ORDER_CREATED', category: 'ORDER', req,
      resourceId: order.id, programId: order.programId,
      details: { totalCards: order.totalCards, totalAmountCents: order.totalAmountCents.toString(), status: order.status },
    });
    res.status(201).json({ data: order, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get order ────────────────────────────────────────────────────────────────
ordersRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    const order = await ordersService.getOrder(req.params['id'] as string, programId);
    res.json({ data: order, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Approve order ────────────────────────────────────────────────────────────
ordersRouter.post('/:id/approve', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ordersService.approveOrder(req.params['id'] as string, req.user!.id);
    void writeAuditLog({ action: 'ORDER_APPROVED', category: 'ORDER', req, resourceId: req.params['id'] as string });
    res.json({ data: result, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Cancel order ─────────────────────────────────────────────────────────────
ordersRouter.post('/:id/cancel', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    const order = await ordersService.cancelOrder(req.params['id'] as string, programId);
    void writeAuditLog({ action: 'ORDER_CANCELLED', category: 'ORDER', req, resourceId: order.id, programId: order.programId });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
