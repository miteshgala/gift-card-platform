/**
 * KYC Routes
 * Manual KYC review and check management for high-value cards.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';

export const kycRouter = Router();

// ─── List KYC checks ──────────────────────────────────────────────────────────
kycRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const limit = Math.min(Number(req.query['limit'] ?? 20), 100);
    const checks = await prismaRead.kycCheck.findMany({
      where: {
        programId: programId ?? undefined,
        status: req.query['status'] as string | undefined,
        checkType: req.query['checkType'] as string | undefined,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        card: { select: { id: true, last4: true, recipientName: true } },
      },
    });
    res.json({ data: checks, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get KYC check ────────────────────────────────────────────────────────────
kycRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const check = await prismaRead.kycCheck.findUnique({
      where: { id: req.params['id'] as string },
      include: { card: { select: { id: true, last4: true, recipientName: true, recipientEmail: true } } },
    });
    if (!check) throw new AppError(404, 'NOT_FOUND', 'KYC check not found');
    if (req.user!.role !== 'SUPER_ADMIN' && check.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    res.json({ data: check, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Create KYC check ─────────────────────────────────────────────────────────
kycRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = z.object({
      cardId: z.string().uuid(),
      checkType: z.enum(['IDENTITY', 'OFAC', 'ENHANCED_DUE_DILIGENCE']),
      provider: z.enum(['INTERNAL', 'PERSONA', 'ALLOY', 'LEXISNEXIS']).default('INTERNAL'),
    }).parse(req.body);

    const card = await prismaRead.card.findUnique({ where: { id: input.cardId }, select: { id: true, programId: true } });
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    if (req.user!.role !== 'SUPER_ADMIN' && card.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

    const check = await prisma.kycCheck.create({
      data: {
        cardId: input.cardId,
        programId: card.programId,
        checkType: input.checkType,
        provider: input.provider,
        status: 'PENDING',
        reasonCodes: [],
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });
    void writeAuditLog({ action: 'KYC_CHECK_CREATED', category: 'CARD', req, resourceId: check.id, programId: check.programId });
    res.status(201).json({ data: check, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Review KYC check ─────────────────────────────────────────────────────────
kycRouter.patch('/:id/review', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'SUPPORT_AGENT'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = z.object({
      status: z.enum(['APPROVED', 'REJECTED', 'REQUIRES_REVIEW']),
      riskScore: z.number().int().min(0).max(100).optional(),
      reasonCodes: z.array(z.string()).default([]),
      reviewNotes: z.string().max(1000).optional(),
    }).parse(req.body);

    const check = await prismaRead.kycCheck.findUnique({ where: { id: req.params['id'] as string } });
    if (!check) throw new AppError(404, 'NOT_FOUND', 'KYC check not found');
    if (req.user!.role !== 'SUPER_ADMIN' && check.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    if (check.status !== 'PENDING' && check.status !== 'REQUIRES_REVIEW') throw new AppError(422, 'INVALID_STATE', 'Check is already resolved');

    const updated = await prisma.kycCheck.update({
      where: { id: check.id },
      data: {
        status: input.status,
        riskScore: input.riskScore ?? null,
        reasonCodes: input.reasonCodes,
        reviewNotes: input.reviewNotes ?? null,
        reviewedBy: req.user!.id,
      },
    });

    // Update card kycStatus if APPROVED or REJECTED
    if (input.status === 'APPROVED' || input.status === 'REJECTED') {
      await prisma.card.update({
        where: { id: check.cardId },
        data: { kycStatus: input.status },
      });
    }

    void writeAuditLog({
      action: 'KYC_REVIEW_COMPLETED', category: 'CARD', req,
      resourceId: check.id, programId: check.programId,
      details: { status: input.status, riskScore: input.riskScore },
    });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
