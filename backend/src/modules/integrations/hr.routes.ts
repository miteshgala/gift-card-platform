/**
 * HR/ERP Inbound Webhook Integration
 *
 * POST /api/v1/integrations/hr-events
 *
 * Accepts HMAC-SHA256-signed payloads from HR systems.
 * Supported events: EMPLOYEE_ONBOARDED, EMPLOYEE_BIRTHDAY,
 *                   EMPLOYEE_ANNIVERSARY, EMPLOYEE_REWARD
 *
 * Each event auto-issues a gift card to the employee email at the
 * denomination configured per program in HrIntegration.eventDenominations.
 *
 * Signature header format: X-HR-Signature: sha256=<hex>
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { issueCard } from '../cards/cards.service';
import { sendEGiftCard } from '../email/email.service';
import { CardType } from '@prisma/client';
import { authenticate, requireMinRole } from '../auth/auth.middleware';
import { UserRole } from '@prisma/client';
import { sendSuccess, sendCreated } from '../../utils/response';
import { AuthenticatedRequest } from '../../types';

const router = Router();

// ─── Supported HR event types ─────────────────────────────────────────────────

const HR_EVENTS = ['EMPLOYEE_ONBOARDED', 'EMPLOYEE_BIRTHDAY', 'EMPLOYEE_ANNIVERSARY', 'EMPLOYEE_REWARD'] as const;
type HrEventType = typeof HR_EVENTS[number];

const hrEventSchema = z.object({
  event: z.enum(HR_EVENTS),
  programId: z.string().cuid(),
  employee: z.object({
    email: z.string().email(),
    name: z.string().optional(),
    employeeId: z.string().optional(),
  }),
  // Optional override — falls back to program config
  denomination: z.number().positive().optional(),
  referenceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── HMAC verification ────────────────────────────────────────────────────────

function verifyHmacSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── POST /hr-events ─────────────────────────────────────────────────────────

router.post('/hr-events', async (req: Request, res: Response) => {
  const signature = req.headers['x-hr-signature'] as string | undefined;
  if (!signature) throw new AppError(401, 'MISSING_SIGNATURE', 'X-HR-Signature header required');

  // Parse and validate body
  const parsed = hrEventSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_PAYLOAD', parsed.error.errors[0]?.message ?? 'Invalid payload');
  }

  const { event, programId, employee, denomination: overrideDenomination, referenceId, metadata } = parsed.data;

  // Load HR integration config for this program
  const integration = await prisma.hrIntegration.findUnique({
    where: { programId },
    select: { signingSecret: true, isActive: true, eventDenominations: true, defaultCampaignId: true },
  });

  if (!integration || !integration.isActive) {
    throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'HR integration not configured for this program');
  }

  // Verify HMAC on raw body string
  const rawBody = JSON.stringify(req.body);
  if (!verifyHmacSignature(rawBody, signature, integration.signingSecret)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'HMAC signature verification failed');
  }

  // Resolve denomination
  const eventDenominations = integration.eventDenominations as Record<string, number>;
  const denomination = overrideDenomination ?? eventDenominations[event];
  if (!denomination || denomination <= 0) {
    throw new AppError(422, 'NO_DENOMINATION', `No denomination configured for event type ${event}`);
  }

  // Issue the card
  logger.info('HR event received — issuing card', { event, programId, email: employee.email, denomination });

  const { card, cardNumber, pin } = await issueCard({
    programId,
    campaignId: integration.defaultCampaignId ?? undefined,
    cardType: CardType.DIGITAL,
    initialBalance: denomination,
    denomination,
    currency: 'USD',
    recipientEmail: employee.email,
    recipientName: employee.name,
    metadata: {
      hrEvent: event,
      employeeId: employee.employeeId,
      referenceId,
      ...(metadata ?? {}),
    },
  });

  // Send the eGift email
  try {
    await sendEGiftCard({
      to: employee.email,
      recipientName: employee.name,
      cardNumber,
      pin,
      balance: denomination,
      currency: 'USD',
      cardNumberMasked: card.cardNumberMasked,
      expiresAt: card.expiresAt ?? undefined,
    });
  } catch (emailErr) {
    logger.error('HR event: card issued but email failed', { cardId: card.id, error: emailErr });
    // Don't fail the request — card was issued successfully
  }

  logger.info('HR event processed', { event, cardId: card.id, email: employee.email });
  res.status(201).json({
    success: true,
    data: {
      cardId: card.id,
      cardNumberMasked: card.cardNumberMasked,
      denomination,
      email: employee.email,
      event,
    },
  });
});

// ─── Admin: configure HR integration for a program ───────────────────────────

const configSchema = z.object({
  programId: z.string().cuid(),
  eventDenominations: z.object({
    EMPLOYEE_ONBOARDED: z.number().positive().optional(),
    EMPLOYEE_BIRTHDAY: z.number().positive().optional(),
    EMPLOYEE_ANNIVERSARY: z.number().positive().optional(),
    EMPLOYEE_REWARD: z.number().positive().optional(),
  }),
  defaultCampaignId: z.string().cuid().optional(),
});

router.post(
  '/hr-config',
  authenticate,
  requireMinRole(UserRole.PROGRAM_ADMIN),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_PAYLOAD', parsed.error.errors[0]?.message ?? 'Invalid');

    const { programId, eventDenominations, defaultCampaignId } = parsed.data;

    // Generate a new signing secret
    const signingSecret = crypto.randomBytes(32).toString('hex');

    const integration = await prisma.hrIntegration.upsert({
      where: { programId },
      create: { programId, signingSecret, eventDenominations, defaultCampaignId },
      update: { eventDenominations, defaultCampaignId, isActive: true },
    });

    sendSuccess(res, {
      id: integration.id,
      programId: integration.programId,
      signingSecret, // returned ONCE on create/reset
      eventDenominations: integration.eventDenominations,
      defaultCampaignId: integration.defaultCampaignId,
    }, 201);
  }
);

router.get(
  '/hr-config/:programId',
  authenticate,
  requireMinRole(UserRole.PROGRAM_ADMIN),
  async (req: AuthenticatedRequest, res: Response) => {
    const integration = await prisma.hrIntegration.findUnique({
      where: { programId: req.params.programId },
      select: { id: true, programId: true, isActive: true, eventDenominations: true, defaultCampaignId: true, createdAt: true, updatedAt: true },
    });
    if (!integration) throw new AppError(404, 'NOT_FOUND', 'HR integration not configured for this program');
    sendSuccess(res, integration);
  }
);

export default router;
