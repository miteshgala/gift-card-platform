/**
 * KYC/KYB Verification Routes
 *
 * Cards with initialBalance >= KYC_THRESHOLD are held in PENDING status
 * until the cardholder's identity is verified.
 *
 * GET  /api/v1/kyc                   — list KYC checks (admin, filterable by status)
 * GET  /api/v1/kyc/:cardId          — check KYC status (admin)
 * POST /api/v1/kyc/:cardId/approve  — manually approve (admin override)
 * POST /api/v1/kyc/:cardId/reject   — manually reject  (admin override)
 * POST /api/v1/kyc/webhook           — receive provider callback (Persona/Jumio-compatible)
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { authenticate, requireMinRole } from '../auth/auth.middleware';
import { UserRole, KycStatus, CardStatus, AuditAction } from '@prisma/client';
import { sendSuccess } from '../../utils/response';
import { AuthenticatedRequest } from '../../types';
import { dispatchWebhook } from '../webhooks/webhooks.service';
import { WebhookEvent } from '@prisma/client';

const router = Router();

// ─── GET /kyc — list KYC checks ───────────────────────────────────────────────

router.get(
  '/',
  authenticate,
  requireMinRole(UserRole.SUPPORT),
  async (req: AuthenticatedRequest, res: Response) => {
    const status = req.query['status'] as string | undefined;
    const page = Math.max(1, Number(req.query['page'] ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query['limit'] ?? 20)));
    const skip = (page - 1) * limit;

    const where = status ? { status: status as KycStatus } : {};
    const [checks, total] = await Promise.all([
      prisma.kycCheck.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          card: { select: { cardNumberMasked: true, programId: true, status: true, initialBalance: true, currency: true } },
        },
      }),
      prisma.kycCheck.count({ where }),
    ]);
    sendSuccess(res, checks, 200, {
      total, page, limit, totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total, hasPrev: page > 1,
    });
  }
);

// ─── GET /kyc/:cardId ─────────────────────────────────────────────────────────

router.get(
  '/:cardId',
  authenticate,
  requireMinRole(UserRole.SUPPORT),
  async (req: AuthenticatedRequest, res: Response) => {
    const check = await prisma.kycCheck.findUnique({
      where: { cardId: req.params.cardId },
      include: { card: { select: { cardNumberMasked: true, programId: true, status: true } } },
    });
    if (!check) throw new AppError(404, 'KYC_NOT_FOUND', 'No KYC check found for this card');
    sendSuccess(res, check);
  }
);

// ─── POST /kyc/:cardId/approve — manual admin override ───────────────────────

router.post(
  '/:cardId/approve',
  authenticate,
  requireMinRole(UserRole.PROGRAM_ADMIN),
  async (req: AuthenticatedRequest, res: Response) => {
    const check = await prisma.kycCheck.findUnique({
      where: { cardId: req.params.cardId },
      include: { card: { select: { id: true, programId: true, status: true } } },
    });
    if (!check) throw new AppError(404, 'KYC_NOT_FOUND', 'No KYC check found for this card');
    if (check.status !== KycStatus.PENDING) throw new AppError(409, 'KYC_ALREADY_RESOLVED', 'KYC check is not pending');

    await prisma.$transaction([
      prisma.kycCheck.update({
        where: { id: check.id },
        data: { status: KycStatus.APPROVED, reviewedAt: new Date(), metadata: { manualOverride: true, reviewedBy: req.user!.sub } as any },
      }),
      prisma.giftCard.update({ where: { id: check.cardId }, data: { status: CardStatus.ACTIVE, activatedAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          action: AuditAction.CARD_ACTIVATE,
          actorId: req.user!.sub,
          actorEmail: req.user!.email,
          resourceType: 'GiftCard',
          resourceId: check.cardId,
          diff: { kycManualApprove: true },
        },
      }),
    ]);

    logger.info('KYC manually approved', { cardId: check.cardId, adminId: req.user!.sub });
    sendSuccess(res, { approved: true, cardId: check.cardId });
  }
);

// ─── POST /kyc/:cardId/reject — manual admin override ────────────────────────

router.post(
  '/:cardId/reject',
  authenticate,
  requireMinRole(UserRole.PROGRAM_ADMIN),
  async (req: AuthenticatedRequest, res: Response) => {
    const reason: string = req.body['reason'] ?? 'Manual rejection by admin';

    const check = await prisma.kycCheck.findUnique({
      where: { cardId: req.params.cardId },
      include: { card: { select: { id: true, programId: true, status: true } } },
    });
    if (!check) throw new AppError(404, 'KYC_NOT_FOUND', 'No KYC check found for this card');
    if (check.status !== KycStatus.PENDING) throw new AppError(409, 'KYC_ALREADY_RESOLVED', 'KYC check is not pending');

    await prisma.$transaction([
      prisma.kycCheck.update({
        where: { id: check.id },
        data: { status: KycStatus.REJECTED, reviewedAt: new Date(), rejectionReason: reason },
      }),
      prisma.giftCard.update({ where: { id: check.cardId }, data: { status: CardStatus.CANCELLED, cancelledAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          action: AuditAction.CARD_CANCEL,
          actorId: req.user!.sub,
          actorEmail: req.user!.email,
          resourceType: 'GiftCard',
          resourceId: check.cardId,
          diff: { kycManualReject: true, reason },
        },
      }),
    ]);

    logger.info('KYC manually rejected', { cardId: check.cardId, adminId: req.user!.sub, reason });
    sendSuccess(res, { rejected: true, cardId: check.cardId });
  }
);

// ─── POST /kyc/webhook — provider callback ────────────────────────────────────
// Compatible with Persona / Jumio webhook format.
// Expects header: X-KYC-Signature: sha256=<hmac-hex>
// Env var KYC_WEBHOOK_SECRET must be set to verify the signature.

const webhookSchema = z.object({
  event: z.enum(['kyc.approved', 'kyc.rejected', 'kyc.expired']),
  referenceId: z.string(), // must match KycCheck.id or providerRef
  providerRef: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post('/webhook', async (req: Request, res: Response) => {
  // Optional HMAC verification — skip if secret not configured (dev mode)
  const secret = process.env['KYC_WEBHOOK_SECRET'];
  if (secret) {
    const sig = req.headers['x-kyc-signature'] as string | undefined;
    if (!sig) throw new AppError(401, 'MISSING_SIGNATURE', 'X-KYC-Signature header required');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        throw new AppError(401, 'INVALID_SIGNATURE', 'KYC webhook signature mismatch');
      }
    } catch {
      throw new AppError(401, 'INVALID_SIGNATURE', 'KYC webhook signature mismatch');
    }
  }

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_PAYLOAD', parsed.error.errors[0]?.message ?? 'Invalid payload');

  const { event, referenceId, providerRef, reason, metadata } = parsed.data;

  // Find KYC check by id or providerRef
  const check = await prisma.kycCheck.findFirst({
    where: { OR: [{ id: referenceId }, { providerRef: referenceId }] },
    include: { card: { select: { id: true, programId: true, status: true } } },
  });

  if (!check) throw new AppError(404, 'KYC_NOT_FOUND', `No KYC check found for referenceId: ${referenceId}`);
  if (check.status !== KycStatus.PENDING) {
    // Idempotent — already processed
    res.json({ success: true, message: 'Already processed' });
    return;
  }

  logger.info('KYC webhook received', { event, cardId: check.cardId, referenceId });

  if (event === 'kyc.approved') {
    await prisma.$transaction([
      prisma.kycCheck.update({
        where: { id: check.id },
        data: { status: KycStatus.APPROVED, reviewedAt: new Date(), providerRef: providerRef ?? check.providerRef, metadata: metadata as any },
      }),
      prisma.giftCard.update({
        where: { id: check.cardId },
        data: { status: CardStatus.ACTIVE, activatedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          action: AuditAction.CARD_ACTIVATE,
          resourceType: 'GiftCard',
          resourceId: check.cardId,
          diff: { kycApproved: true, referenceId },
        },
      }),
    ]);
    logger.info('KYC approved — card activated', { cardId: check.cardId });

  } else if (event === 'kyc.rejected') {
    await prisma.$transaction([
      prisma.kycCheck.update({
        where: { id: check.id },
        data: {
          status: KycStatus.REJECTED,
          reviewedAt: new Date(),
          rejectionReason: reason,
          providerRef: providerRef ?? check.providerRef,
        },
      }),
      prisma.giftCard.update({
        where: { id: check.cardId },
        data: { status: CardStatus.CANCELLED, cancelledAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          action: AuditAction.CARD_CANCEL,
          resourceType: 'GiftCard',
          resourceId: check.cardId,
          diff: { kycRejected: true, reason, referenceId },
        },
      }),
    ]);

    // Fire CARD_CANCELLED webhook
    dispatchWebhook(check.card.programId, WebhookEvent.CARD_CANCELLED, {
      event: WebhookEvent.CARD_CANCELLED,
      cardId: check.cardId,
      reason: `KYC rejected: ${reason ?? 'no reason provided'}`,
    }, check.cardId).catch(() => {});

    logger.info('KYC rejected — card cancelled', { cardId: check.cardId, reason });

  } else if (event === 'kyc.expired') {
    await prisma.kycCheck.update({
      where: { id: check.id },
      data: { status: KycStatus.EXPIRED, reviewedAt: new Date() },
    });
    logger.info('KYC expired', { cardId: check.cardId });
  }

  res.json({ success: true });
});

export default router;
