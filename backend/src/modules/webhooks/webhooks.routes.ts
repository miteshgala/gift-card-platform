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
