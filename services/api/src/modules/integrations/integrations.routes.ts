/**
 * Integrations Routes
 * HR event integration, GL mapping management, and SFTP batch processing.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { issueCard } from '../cards/cards.service';

export const integrationsRouter = Router();

const hrEventSchema = z.object({
  programId: z.string().uuid().optional(),
  eventType: z.enum(['NEW_HIRE', 'WORK_ANNIVERSARY', 'PERFORMANCE_AWARD', 'BIRTHDAY', 'RETIREMENT']),
  employeeId: z.string().min(1).max(100),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  state: z.string().length(2).optional(),
  overrideAmountCents: z.coerce.bigint().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const glMappingSchema = z.object({
  programId: z.string().uuid().optional(),
  accountType: z.string().min(2).max(50),
  glAccountCode: z.string().min(1).max(50),
  glDescription: z.string().min(2).max(200),
  erpSystem: z.enum(['SAP', 'ORACLE', 'NETSUITE', 'GENERIC']),
});

const hrRuleSchema = z.object({
  programId: z.string().uuid().optional(),
  eventType: z.enum(['NEW_HIRE', 'WORK_ANNIVERSARY', 'PERFORMANCE_AWARD', 'BIRTHDAY', 'RETIREMENT']),
  campaignId: z.string().uuid().optional(),
  amountCents: z.coerce.bigint().positive(),
  cardType: z.enum(['PHYSICAL', 'VIRTUAL']).default('VIRTUAL'),
  enabled: z.boolean().default(true),
});

// ─── HR event trigger ─────────────────────────────────────────────────────────

integrationsRouter.post('/hr/events', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'API_SERVICE'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = hrEventSchema.parse(req.body);
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : input.programId!;
    if (!programId) throw new AppError(400, 'PROGRAM_REQUIRED', 'programId is required');

    // Look up the HR rule for this event type
    const rule = await prismaRead.hrEventRule.findUnique({
      where: { programId_eventType: { programId, eventType: input.eventType } },
    });

    if (!rule || !rule.enabled) {
      return res.status(202).json({
        data: { processed: false, reason: 'No active HR rule for this event type' },
        meta: { requestId: req.requestId },
      });
    }

    const amountCents = input.overrideAmountCents ?? rule.amountCents;
    const program = await prismaRead.program.findUniqueOrThrow({
      where: { id: programId },
      select: { currency: true },
    });

    // Issue a card for the employee
    const card = await issueCard({
      programId,
      campaignId: rule.campaignId ?? undefined,
      cardType: rule.cardType as 'PHYSICAL' | 'VIRTUAL' | 'SINGLE_USE',
      amountCents,
      currency: program.currency,
      recipientName: `${input.firstName} ${input.lastName}`,
      recipientEmail: input.email,
      recipientPhone: input.phone,
      recipientState: input.state,
      pin: '0000', // Employee must change PIN on first use
      issuedBy: req.user!.id,
    });

    void writeAuditLog({
      action: 'HR_EVENT_CARD_ISSUED', category: 'CARD', req,
      resourceId: card.cardId, programId,
      details: { eventType: input.eventType, employeeId: input.employeeId, amountCents: amountCents.toString() },
    });

    res.status(201).json({
      data: { processed: true, cardId: card.cardId, last4: card.last4, amountCents: amountCents.toString() },
      meta: { requestId: req.requestId },
    });
  } catch (err) { next(err); }
});

// ─── HR event rules ────────────────────────────────────────────────────────────

integrationsRouter.get('/hr/rules', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const rules = await prismaRead.hrEventRule.findMany({
      where: { programId: programId ?? undefined },
      orderBy: { eventType: 'asc' },
    });
    res.json({ data: rules, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

integrationsRouter.post('/hr/rules', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = hrRuleSchema.parse(req.body);
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : input.programId!;
    if (!programId) throw new AppError(400, 'PROGRAM_REQUIRED', 'programId is required');

    const rule = await prisma.hrEventRule.upsert({
      where: { programId_eventType: { programId, eventType: input.eventType } },
      update: { amountCents: input.amountCents, cardType: input.cardType, enabled: input.enabled, campaignId: input.campaignId ?? null },
      create: { programId, eventType: input.eventType, amountCents: input.amountCents, cardType: input.cardType, enabled: input.enabled, campaignId: input.campaignId ?? null },
    });
    res.json({ data: rule, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

integrationsRouter.patch('/hr/rules/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = hrRuleSchema.partial().parse(req.body);
    const rule = await prismaRead.hrEventRule.findUnique({ where: { id: req.params['id'] as string } });
    if (!rule) throw new AppError(404, 'NOT_FOUND', 'HR rule not found');
    if (req.user!.role !== 'SUPER_ADMIN' && rule.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    const updated = await prisma.hrEventRule.update({
      where: { id: rule.id },
      data: { amountCents: input.amountCents, cardType: input.cardType, enabled: input.enabled, campaignId: input.campaignId ?? null },
    });
    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── GL mappings ───────────────────────────────────────────────────────────────

integrationsRouter.get('/gl/mappings', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const mappings = await prismaRead.glMapping.findMany({
      where: { programId: programId ?? undefined },
      orderBy: { accountType: 'asc' },
    });
    res.json({ data: mappings, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

integrationsRouter.post('/gl/mappings', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = glMappingSchema.parse(req.body);
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : input.programId!;
    if (!programId) throw new AppError(400, 'PROGRAM_REQUIRED', 'programId is required');

    const mapping = await prisma.glMapping.upsert({
      where: { programId_accountType: { programId, accountType: input.accountType } },
      update: { glAccountCode: input.glAccountCode, glDescription: input.glDescription, erpSystem: input.erpSystem },
      create: { programId, accountType: input.accountType, glAccountCode: input.glAccountCode, glDescription: input.glDescription, erpSystem: input.erpSystem },
    });
    res.json({ data: mapping, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

integrationsRouter.delete('/gl/mappings/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mapping = await prismaRead.glMapping.findUnique({ where: { id: req.params['id'] as string } });
    if (!mapping) throw new AppError(404, 'NOT_FOUND', 'GL mapping not found');
    if (req.user!.role !== 'SUPER_ADMIN' && mapping.programId !== req.user!.programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
    await prisma.glMapping.delete({ where: { id: mapping.id } });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
