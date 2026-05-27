import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate, requireSuperAdmin, requireMinRole } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess, sendCreated } from '../../utils/response';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// ─── Create program ───────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50),
  description: z.string().optional(),
  currency: z.string().length(3).default('USD'),
  budgetCap: z.number().positive().optional(),
  approvalThreshold: z.number().positive().optional(),
  cardExpiryDays: z.number().int().positive().default(365),
  allowPartialRedeem: z.boolean().default(true),
});

router.post('/', requireSuperAdmin, validate(createSchema), async (_req, res) => {
  const data = _req.body as z.infer<typeof createSchema>;
  const program = await prisma.program.create({
    data: {
      ...data,
      budgetCap: data.budgetCap ? new Prisma.Decimal(data.budgetCap) : undefined,
      approvalThreshold: data.approvalThreshold ? new Prisma.Decimal(data.approvalThreshold) : undefined,
    },
  });
  sendCreated(res, program);
});

// ─── List programs ────────────────────────────────────────────────────────────
router.get('/', async (req: AuthenticatedRequest, res) => {
  const where = req.user?.role === UserRole.SUPER_ADMIN
    ? {}
    : { id: req.user?.programId };

  const programs = await prisma.program.findMany({
    where,
    orderBy: { name: 'asc' },
  });
  sendSuccess(res, programs);
});

// ─── Get program ──────────────────────────────────────────────────────────────
router.get('/:programId', async (req: AuthenticatedRequest, res) => {
  const program = await prisma.program.findUnique({ where: { id: req.params.programId } });
  if (!program) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
  if (req.user?.role !== UserRole.SUPER_ADMIN && program.id !== req.user?.programId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }
  sendSuccess(res, program);
});

// ─── Update program ───────────────────────────────────────────────────────────
const updateSchema = createSchema.partial();

router.patch('/:programId', requireMinRole(UserRole.PROGRAM_ADMIN), validate(updateSchema), async (req: AuthenticatedRequest, res) => {
  const data = req.body as z.infer<typeof updateSchema>;
  const program = await prisma.program.update({
    where: { id: req.params.programId },
    data: {
      ...data,
      budgetCap: data.budgetCap ? new Prisma.Decimal(data.budgetCap) : undefined,
      approvalThreshold: data.approvalThreshold ? new Prisma.Decimal(data.approvalThreshold) : undefined,
    },
  });
  sendSuccess(res, program);
});

// ─── Campaigns ────────────────────────────────────────────────────────────────
const campaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  bonusLoadPercent: z.number().min(0).max(100).default(0),
  expiryDays: z.number().int().positive().optional(),
  minLoadAmount: z.number().positive().optional(),
  maxLoadAmount: z.number().positive().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  usageRestrictions: z.record(z.unknown()).optional(),
});

router.post('/:programId/campaigns', requireMinRole(UserRole.MARKETING), validate(campaignSchema), async (req, res) => {
  const data = req.body as z.infer<typeof campaignSchema>;
  const campaign = await prisma.campaign.create({
    data: {
      programId: req.params.programId,
      ...data,
      minLoadAmount: data.minLoadAmount ? new Prisma.Decimal(data.minLoadAmount) : undefined,
      maxLoadAmount: data.maxLoadAmount ? new Prisma.Decimal(data.maxLoadAmount) : undefined,
      usageRestrictions: data.usageRestrictions as Prisma.InputJsonValue,
    },
  });
  sendCreated(res, campaign);
});

router.get('/:programId/campaigns', async (req, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { programId: req.params.programId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, campaigns);
});

// ─── Departments ──────────────────────────────────────────────────────────────
router.get('/:programId/departments', async (req, res) => {
  const departments = await prisma.department.findMany({ where: { programId: req.params.programId } });
  sendSuccess(res, departments);
});

router.post('/:programId/departments', requireMinRole(UserRole.PROGRAM_ADMIN), async (req, res) => {
  const schema = z.object({ name: z.string().min(1), budgetCap: z.number().positive().optional() });
  const data = schema.parse(req.body);
  const dept = await prisma.department.create({
    data: {
      programId: req.params.programId,
      name: data.name,
      budgetCap: data.budgetCap ? new Prisma.Decimal(data.budgetCap) : undefined,
    },
  });
  sendCreated(res, dept);
});

export default router;
