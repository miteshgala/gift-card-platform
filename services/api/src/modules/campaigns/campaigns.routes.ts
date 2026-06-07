import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { idempotency } from '../../shared/middleware/idempotency';
import { writeAuditLog } from '../../shared/middleware/auditLog';
import * as campaignsService from './campaigns.service';

export const campaignsRouter = Router();

const createCampaignSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  bonusLoadPercent: z.number().min(0).max(100).optional(),
  expiryDays: z.number().int().min(1).max(3650).optional(),
  maxCards: z.number().int().positive().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).default({}),
});

function resolveProgramId(req: Request, inputProgramId?: string): string {
  if (req.user!.role === 'SUPER_ADMIN') return inputProgramId!;
  return req.user!.programId!;
}

// ─── List campaigns ───────────────────────────────────────────────────────────
campaignsRouter.get('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN'
      ? req.query['programId'] as string
      : req.user!.programId!;
    if (!programId) return res.status(400).json({ error: { code: 'MISSING_PROGRAM_ID', message: 'programId query param required' } });
    const result = await campaignsService.listCampaigns(programId, {
      status: req.query['status'] as string | undefined,
      cursor: req.query['cursor'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    });
    res.json({ data: result.items, meta: { requestId: req.requestId, hasMore: result.hasMore, nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
});

// ─── Create campaign ──────────────────────────────────────────────────────────
campaignsRouter.post('/', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createCampaignSchema.parse(req.body);
    // Non-SUPER_ADMIN must use own program
    if (req.user!.role !== 'SUPER_ADMIN') input.programId = req.user!.programId!;
    const campaign = await campaignsService.createCampaign(input);
    void writeAuditLog({ action: 'CAMPAIGN_CREATED', category: 'SYSTEM', req, resourceId: campaign.id, programId: campaign.programId });
    res.status(201).json({ data: campaign, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Get campaign ─────────────────────────────────────────────────────────────
campaignsRouter.get('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    const campaign = await campaignsService.getCampaign(req.params['id'] as string, programId);
    res.json({ data: campaign, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Update campaign ──────────────────────────────────────────────────────────
campaignsRouter.patch('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createCampaignSchema.partial().parse(req.body);
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    const campaign = await campaignsService.updateCampaign(req.params['id'] as string, programId, input);
    void writeAuditLog({ action: 'CAMPAIGN_UPDATED', category: 'SYSTEM', req, resourceId: campaign.id, programId: campaign.programId });
    res.json({ data: campaign, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Deactivate campaign ──────────────────────────────────────────────────────
campaignsRouter.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN'), idempotency, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.programId! : undefined;
    await campaignsService.deactivateCampaign(req.params['id'] as string, programId);
    void writeAuditLog({ action: 'CAMPAIGN_DEACTIVATED', category: 'SYSTEM', req, resourceId: req.params['id'] as string });
    res.json({ data: { success: true }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
