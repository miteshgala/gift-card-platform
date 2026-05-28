import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { authenticate, requireMinRole, requireSuperAdmin } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/response';
import { prisma } from '../../config/prisma';
import { hashPassword } from '../../utils/crypto';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { buildMeta, getPrismaSkip } from '../../utils/pagination';

const router = Router();
router.use(authenticate);

// ─── List users ───────────────────────────────────────────────────────────────
const listSchema = z.object({
  programId: z.string().cuid().optional(),
  role: z.nativeEnum(UserRole).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', requireMinRole(UserRole.PROGRAM_ADMIN), validate(listSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;

  // Non-super-admins see only their program's users
  const programId = req.user?.role !== UserRole.SUPER_ADMIN ? req.user?.programId : q.programId;

  const where = {
    ...(programId && { programId }),
    ...(q.role && { role: q.role }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: getPrismaSkip(page, limit),
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, programId: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  sendSuccess(res, users, 200, buildMeta(total, page, limit));
});

// ─── Get user ─────────────────────────────────────────────────────────────────
router.get('/:userId', requireMinRole(UserRole.PROGRAM_ADMIN), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, programId: true, isActive: true, lastLoginAt: true, createdAt: true,
    },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  sendSuccess(res, user);
});

// ─── Update user role ─────────────────────────────────────────────────────────
const roleSchema = z.object({ role: z.nativeEnum(UserRole) });

router.patch('/:userId/role', requireSuperAdmin, validate(roleSchema), async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { role: req.body.role },
    select: { id: true, email: true, role: true },
  });
  await prisma.auditLog.create({
    data: {
      actorId: req.user!.sub,
      action: 'USER_ROLE_CHANGE',
      resourceType: 'User',
      resourceId: req.params.userId,
      diff: { newRole: req.body.role },
    },
  });
  sendSuccess(res, user);
});

// ─── Deactivate user ──────────────────────────────────────────────────────────
router.patch('/:userId/deactivate', requireSuperAdmin, async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { isActive: false },
    select: { id: true, email: true, isActive: true },
  });
  sendSuccess(res, user);
});

// ─── Audit log ────────────────────────────────────────────────────────────────
router.get('/audit-log', requireMinRole(UserRole.PROGRAM_ADMIN), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    programId: z.string().cuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const q = schema.parse(req.query);
  const programId = req.user?.role !== UserRole.SUPER_ADMIN ? req.user?.programId : q.programId;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { ...(programId && { programId }) },
      skip: getPrismaSkip(q.page, q.limit),
      take: q.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.count({ where: { ...(programId && { programId }) } }),
  ]);

  sendSuccess(res, logs, 200, buildMeta(total, q.page, q.limit));
});

export default router;
