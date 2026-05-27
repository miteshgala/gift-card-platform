import { Router } from 'express';
import { z } from 'zod';
import { FraudSeverity } from '@prisma/client';
import { authenticate, requireMinRole, requireSupport } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as fraudService from './fraud.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// ─── List fraud flags ─────────────────────────────────────────────────────────
const listFlagsSchema = z.object({
  programId: z.string().cuid().optional(),
  cardId: z.string().cuid().optional(),
  severity: z.nativeEnum(FraudSeverity).optional(),
  resolved: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/flags', requireSupport, validate(listFlagsSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as z.infer<typeof listFlagsSchema>;
  if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.programId) {
    filters.programId = req.user.programId;
  }
  const result = await fraudService.listFraudFlags(filters);
  sendSuccess(res, result.flags, 200, result.meta);
});

// ─── Resolve a flag ───────────────────────────────────────────────────────────
const resolveSchema = z.object({ resolution: z.string().min(1) });

router.post('/flags/:flagId/resolve', requireSupport, validate(resolveSchema), async (req: AuthenticatedRequest, res) => {
  const flag = await fraudService.resolveFraudFlag(req.params.flagId, req.body.resolution, req.user!.sub);
  sendSuccess(res, flag);
});

// ─── Velocity rules ───────────────────────────────────────────────────────────
const createRuleSchema = z.object({
  programId: z.string().cuid(),
  name: z.string().min(1),
  windowSeconds: z.number().int().positive(),
  maxAmount: z.number().positive().optional(),
  maxCount: z.number().int().positive().optional(),
  scope: z.enum(['card', 'program', 'email']).default('card'),
}).refine((d) => d.maxAmount !== undefined || d.maxCount !== undefined, {
  message: 'At least one of maxAmount or maxCount must be set',
});

router.post('/velocity-rules', requireMinRole(UserRole.PROGRAM_ADMIN), validate(createRuleSchema), async (_req, res) => {
  const rule = await fraudService.createVelocityRule(_req.body);
  sendCreated(res, rule);
});

router.get('/velocity-rules', requireMinRole(UserRole.PROGRAM_ADMIN), async (req: AuthenticatedRequest, res) => {
  const programId = req.query.programId as string || req.user?.programId || '';
  const rules = await fraudService.listVelocityRules(programId);
  sendSuccess(res, rules);
});

router.delete('/velocity-rules/:ruleId', requireMinRole(UserRole.PROGRAM_ADMIN), async (req: AuthenticatedRequest, res) => {
  const programId = req.user?.programId || req.query.programId as string;
  await fraudService.deleteVelocityRule(req.params.ruleId, programId);
  sendSuccess(res, { deleted: true });
});

export default router;
