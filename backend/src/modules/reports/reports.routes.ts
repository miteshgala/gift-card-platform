import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireFinance } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/response';
import * as reportsService from './reports.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';
import { getRates, getSupportedCurrencies } from '../../utils/fx';

const router = Router();

// ─── FX Rates (public-ish — authenticated but no finance role required) ───────
router.get('/fx/rates', authenticate, async (_req, res) => {
  const rates = await getRates();
  const currencies = await getSupportedCurrencies();
  sendSuccess(res, { ...rates, supportedCurrencies: currencies });
});

router.use(requireFinance);

const dateRangeSchema = z.object({
  programId: z.string().cuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});

function injectProgramId(req: AuthenticatedRequest, filters: { programId?: string }) {
  if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.programId) {
    filters.programId = req.user.programId;
  }
}

async function sendReport(
  res: AuthenticatedRequest['res'] & { setHeader: (k: string, v: string) => void; send: (d: unknown) => void },
  format: string,
  title: string,
  data: Record<string, unknown> | Record<string, unknown>[]
) {
  const rows = Array.isArray(data) ? data : [data];
  if (format === 'csv') {
    const csv = reportsService.toCSV(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s/g, '_')}.csv"`);
    res.send(csv);
  } else if (format === 'pdf') {
    const pdf = await reportsService.generateReportPDF(title, rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s/g, '_')}.pdf"`);
    res.send(pdf);
  } else {
    sendSuccess(res as never, data);
  }
}

// ─── Liability ─────────────────────────────────────────────────────────────────
router.get('/liability', validate(z.object({ programId: z.string().cuid().optional(), format: z.enum(['json', 'csv', 'pdf']).default('json') }), 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as { programId?: string; format: string };
  injectProgramId(req, filters);
  const data = await reportsService.getOutstandingLiability(filters.programId);
  await sendReport(res as never, filters.format, 'Outstanding Liability', data as Record<string, unknown>);
});

// ─── Breakage ─────────────────────────────────────────────────────────────────
router.get('/breakage', validate(dateRangeSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as z.infer<typeof dateRangeSchema>;
  injectProgramId(req, filters);
  const data = await reportsService.getBreakageReport(filters);
  await sendReport(res as never, filters.format, 'Breakage Report', data as Record<string, unknown>);
});

// ─── Redemption Rate ───────────────────────────────────────────────────────────
router.get('/redemption-rate', validate(dateRangeSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as z.infer<typeof dateRangeSchema>;
  injectProgramId(req, filters);
  const data = await reportsService.getRedemptionRate(filters);
  await sendReport(res as never, filters.format, 'Redemption Rate', data as Record<string, unknown>);
});

// ─── Transaction Volume ────────────────────────────────────────────────────────
router.get('/transaction-volume', validate(dateRangeSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as z.infer<typeof dateRangeSchema>;
  injectProgramId(req, filters);
  const data = await reportsService.getTransactionVolume(filters);
  await sendReport(res as never, filters.format, 'Transaction Volume', data as Record<string, unknown>);
});

// ─── Analytics Dashboard ──────────────────────────────────────────────────────
router.get('/analytics', validate(z.object({ programId: z.string().cuid().optional() }), 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as { programId?: string };
  injectProgramId(req, filters);
  const data = await reportsService.getAnalyticsDashboard(filters.programId);
  sendSuccess(res, data);
});

// ─── Escheatment ──────────────────────────────────────────────────────────────
const escheatSchema = z.object({
  programId: z.string().cuid().optional(),
  dormantDays: z.coerce.number().int().positive().default(365),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});

router.get('/escheatment', validate(escheatSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as z.infer<typeof escheatSchema>;
  injectProgramId(req, filters);
  const data = await reportsService.getEscheatmentReport(filters.dormantDays, filters.programId);
  await sendReport(res as never, filters.format, 'Escheatment Report', data.cards as Record<string, unknown>[]);
});

export default router;
