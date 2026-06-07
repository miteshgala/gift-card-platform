import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import * as usersService from './users.service';

export const usersRouter = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  role: z.string(),
  programId: z.string().uuid().optional(),
});

const updateRoleSchema = z.object({
  role: z.string(),
  programId: z.string().uuid().nullable().optional(),
});

// ─── List users ───────────────────────────────────────────────────────────────
usersRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const result = await usersService.listUsers({
      programId,
      role: req.query['role'] as string | undefined,
      status: req.query['status'] as string | undefined,
      cursor: req.query['cursor'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    });
    res.json({ data: result.items, meta: { requestId: req.requestId, hasMore: result.hasMore, nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
});

// ─── Invite user ──────────────────────────────────────────────────────────────
usersRouter.post('/invite', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = inviteSchema.parse(req.body);
    // Program admin can only invite within their own program
    if (req.user!.role === 'PROGRAM_ADMIN') {
      input.programId = req.user!.programId!;
      // Prevent escalation — program admin cannot create SUPER_ADMIN
      if (input.role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot create SUPER_ADMIN', requestId: req.requestId } });
      }
    }
    const result = await usersService.inviteUser({ ...input, invitedBy: req.user!.id });
    void writeAuditLog({ action: 'USER_INVITED', category: 'USER', req, resourceId: result.userId, programId: input.programId, details: { email: input.email, role: input.role } });
    res.status(201).json({ data: { userId: result.userId, email: result.email, expiresAt: result.expiresAt }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get current user (me) ────────────────────────────────────────────────────
usersRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usersService.getUser(req.user!.id);
    res.json({ data: user, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get user by ID ───────────────────────────────────────────────────────────
usersRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usersService.getUser(req.params['id'] as string);
    // Program admin can only view users in their program
    if (req.user!.role === 'PROGRAM_ADMIN' && user.programId !== req.user!.programId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied', requestId: req.requestId } });
    }
    res.json({ data: user, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Update role ──────────────────────────────────────────────────────────────
usersRouter.patch('/:id/role', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role, programId } = updateRoleSchema.parse(req.body);
    const user = await usersService.updateUserRole(req.params['id'] as string, role, programId);
    void writeAuditLog({ action: 'USER_ROLE_UPDATED', category: 'USER', req, resourceId: user.id, details: { role, programId } });
    res.json({ data: user, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Suspend user ─────────────────────────────────────────────────────────────
usersRouter.patch('/:id/suspend', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await usersService.suspendUser(req.params['id'] as string);
    void writeAuditLog({ action: 'USER_SUSPENDED', category: 'USER', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Activate user ────────────────────────────────────────────────────────────
usersRouter.patch('/:id/activate', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await usersService.activateUser(req.params['id'] as string);
    void writeAuditLog({ action: 'USER_ACTIVATED', category: 'USER', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Deactivate user ──────────────────────────────────────────────────────────
usersRouter.delete('/:id', authenticate, authorize('SUPER_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await usersService.deactivateUser(req.params['id'] as string);
    void writeAuditLog({ action: 'USER_DEACTIVATED', category: 'USER', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── List API keys ────────────────────────────────────────────────────────────
usersRouter.get('/:userId/api-keys', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string : req.user!.programId!;
    const keys = await usersService.listApiKeys(req.params['userId'] as string, programId);
    res.json({ data: keys, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Revoke API key ───────────────────────────────────────────────────────────
usersRouter.delete('/api-keys/:keyId', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    await usersService.revokeApiKey(req.params['keyId'] as string, programId);
    void writeAuditLog({ action: 'API_KEY_REVOKED', category: 'USER', req, resourceId: req.params['keyId'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
