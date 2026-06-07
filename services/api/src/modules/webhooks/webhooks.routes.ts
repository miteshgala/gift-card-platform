/**
 * Webhooks Routes
 * Manage webhook endpoints and trigger test events.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { encrypt, generateSecureToken } from '../../shared/utils/crypto';
import { AppError } from '../../shared/errors/AppError';

export const webhooksRouter = Router();

const VALID_EVENTS = [
  'card.issued', 'card.activated', 'card.suspended', 'card.cancelled',
  'card.authorized', 'card.captured', 'card.voided', 'card.reversed',
  'card.balance_low', 'card.expiry_approaching',
  'order.created', 'order.approved', 'order.completed', 'order.failed',
  'dispute.created', 'dispute.resolved',
  'kyc.approved', 'kyc.rejected',
  'program.reconciliation_alert',
];

const endpointSchema = z.object({
  url: z.string().url(),
  description: z.string().max(200).optional(),
  events: z.array(z.string()).min(1),
  programId: z.string().uuid().optional(),
});

// ─── List endpoints ───────────────────────────────────────────────────────────
webhooksRouter.get('/endpoints', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const endpoints = await prismaRead.webhookEndpoint.findMany({
      where: { programId: programId ?? undefined },
      select: { id: true, url: true, description: true, events: true, status: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // Never return the secret
    res.json({ data: endpoints, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Create endpoint ──────────────────────────────────────────────────────────
webhooksRouter.post('/endpoints', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = endpointSchema.parse(req.body);
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : input.programId!;

    // Validate event types
    const invalidEvents = input.events.filter((e) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new AppError(400, 'INVALID_EVENTS', `Invalid event types: ${invalidEvents.join(', ')}`);
    }

    // Generate and encrypt signing secret
    const rawSecret = generateSecureToken(32);
    const encryptedSecret = encrypt(rawSecret);

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        programId,
        url: input.url,
        description: input.description ?? null,
        events: input.events,
        secret: encryptedSecret,
        status: 'ACTIVE',
      },
      select: { id: true, url: true, description: true, events: true, status: true, createdAt: true },
    });

    void writeAuditLog({ action: 'WEBHOOK_ENDPOINT_CREATED', category: 'SYSTEM', req, resourceId: endpoint.id, programId });

    // Return the raw secret once — it can never be retrieved again
    res.status(201).json({ data: { ...endpoint, signingSecret: rawSecret }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Update endpoint ──────────────────────────────────────────────────────────
webhooksRouter.patch('/endpoints/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = endpointSchema.partial().parse(req.body);
    const endpoint = await prismaRead.webhookEndpoint.findUnique({ where: { id: req.params['id'] as string } });
    if (!endpoint) throw new AppError(404, 'NOT_FOUND', 'Webhook endpoint not found');
    if (req.user!.role !== 'SUPER_ADMIN' && endpoint.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

    if (input.events) {
      const invalidEvents = input.events.filter((e) => !VALID_EVENTS.includes(e));
      if (invalidEvents.length > 0) throw new AppError(400, 'INVALID_EVENTS', `Invalid event types: ${invalidEvents.join(', ')}`);
    }

    const updated = await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { url: input.url, description: input.description, events: input.events },
      select: { id: true, url: true, description: true, events: true, status: true, createdAt: true, updatedAt: true },
    });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Disable/enable endpoint ──────────────────────────────────────────────────
webhooksRouter.patch('/endpoints/:id/status', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
    const endpoint = await prismaRead.webhookEndpoint.findUnique({ where: { id: req.params['id'] as string } });
    if (!endpoint) throw new AppError(404, 'NOT_FOUND', 'Webhook endpoint not found');
    if (req.user!.role !== 'SUPER_ADMIN' && endpoint.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { status } });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Delete endpoint ──────────────────────────────────────────────────────────
webhooksRouter.delete('/endpoints/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = await prismaRead.webhookEndpoint.findUnique({ where: { id: req.params['id'] as string } });
    if (!endpoint) throw new AppError(404, 'NOT_FOUND', 'Webhook endpoint not found');
    if (req.user!.role !== 'SUPER_ADMIN' && endpoint.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    void writeAuditLog({ action: 'WEBHOOK_ENDPOINT_DELETED', category: 'SYSTEM', req, resourceId: endpoint.id, programId: endpoint.programId });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── List deliveries ──────────────────────────────────────────────────────────
webhooksRouter.get('/endpoints/:id/deliveries', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = await prismaRead.webhookEndpoint.findUnique({ where: { id: req.params['id'] as string } });
    if (!endpoint) throw new AppError(404, 'NOT_FOUND', 'Webhook endpoint not found');
    if (req.user!.role !== 'SUPER_ADMIN' && endpoint.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    const deliveries = await prismaRead.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, event: true, status: true, attemptCount: true, lastHttpStatus: true, nextAttemptAt: true, createdAt: true },
    });
    res.json({ data: deliveries, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── List valid events ────────────────────────────────────────────────────────
webhooksRouter.get('/events', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), (_req: Request, res: Response) => {
  res.json({ data: VALID_EVENTS });
});
