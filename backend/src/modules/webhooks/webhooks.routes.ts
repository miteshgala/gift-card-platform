import { Router } from 'express';
import { z } from 'zod';
import { WebhookEvent } from '@prisma/client';
import { authenticate, requireMinRole } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as webhooksService from './webhooks.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate, requireMinRole(UserRole.PROGRAM_ADMIN));

// ─── Webhook endpoints ────────────────────────────────────────────────────────
const createEndpointSchema = z.object({
  programId: z.string().cuid(),
  url: z.string().url(),
  events: z.array(z.nativeEnum(WebhookEvent)).min(1),
  description: z.string().optional(),
});

router.post('/endpoints', validate(createEndpointSchema), async (_req, res) => {
  const result = await webhooksService.createWebhookEndpoint(_req.body);
  sendCreated(res, result);
});

router.get('/endpoints', async (req: AuthenticatedRequest, res) => {
  const programId = (req.query.programId as string) || req.user!.programId!;
  const endpoints = await webhooksService.listWebhookEndpoints(programId);
  sendSuccess(res, endpoints);
});

router.delete('/endpoints/:endpointId', async (req: AuthenticatedRequest, res) => {
  const programId = (req.query.programId as string) || req.user!.programId!;
  await webhooksService.deleteWebhookEndpoint(req.params.endpointId, programId);
  sendSuccess(res, { deleted: true });
});

router.get('/endpoints/:endpointId/deliveries', async (req: AuthenticatedRequest, res) => {
  const page = Math.max(1, Number(req.query['page'] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query['limit'] ?? 20)));
  const skip = (page - 1) * limit;

  const { prisma } = await import('../../config/prisma');
  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where: { endpointId: req.params.endpointId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, event: true, status: true, attempts: true,
        responseStatus: true, errorMessage: true, lastAttemptAt: true, createdAt: true,
      },
    }),
    prisma.webhookDelivery.count({ where: { endpointId: req.params.endpointId } }),
  ]);
  sendSuccess(res, deliveries, 200, {
    total, page, limit, totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total, hasPrev: page > 1,
  });
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
const createKeySchema = z.object({
  programId: z.string().cuid(),
  name: z.string().min(1),
  isSandbox: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

router.post('/api-keys', validate(createKeySchema), async (_req, res) => {
  const result = await webhooksService.createApiKey(_req.body);
  sendCreated(res, result);
});

router.get('/api-keys', async (req: AuthenticatedRequest, res) => {
  const programId = (req.query.programId as string) || req.user!.programId!;
  const keys = await webhooksService.listApiKeys(programId);
  sendSuccess(res, keys);
});

router.delete('/api-keys/:keyId', async (req: AuthenticatedRequest, res) => {
  const programId = (req.query.programId as string) || req.user!.programId!;
  await webhooksService.revokeApiKey(req.params.keyId, programId);
  sendSuccess(res, { revoked: true });
});

export default router;
