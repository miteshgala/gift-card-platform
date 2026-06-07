/**
 * Reports Routes
 * Standard financial and operational reports.
 *
 * Reports:
 *   GET /reports/card-liability       — outstanding card liability by program
 *   GET /reports/issuance             — card issuance summary by period
 *   GET /reports/redemption           — redemption activity by period
 *   GET /reports/dormancy             — dormancy assessment history
 *   GET /reports/escheatment          — escheatment records by state
 *   GET /reports/gl-export            — journal entries formatted for ERP
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../shared/middleware/authenticate';
import { prismaRead } from '../../shared/db/prisma';
import { getBalance } from '../ledger/ledger.service';
import { AppError } from '../../shared/errors/AppError';

export const reportsRouter = Router();

const dateRangeSchema = z.object({
  programId: z.string().uuid().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  currency: z.string().length(3).default('USD'),
});

// ─── Card liability report ─────────────────────────────────────────────────────
reportsRouter.get('/card-liability', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;

    const programs = await prismaRead.program.findMany({
      where: { id: programId ?? undefined, status: 'ACTIVE' },
      select: {
        id: true, slug: true, name: true, currency: true,
        floatAccountId: true, liabilityAccountId: true,
      },
    });

    const rows = await Promise.all(programs.map(async (p) => {
      const [floatBal, liabilityBal] = await Promise.all([
        p.floatAccountId ? getBalance(p.floatAccountId) : null,
        p.liabilityAccountId ? getBalance(p.liabilityAccountId) : null,
      ]);

      // Count active card accounts
      const cardAccounts = await prismaRead.account.findMany({
        where: { programId: p.id, accountType: 'CARD', status: 'ACTIVE' },
        select: { id: true },
      });
      const cardBalances = await Promise.all(cardAccounts.slice(0, 500).map((a) => getBalance(a.id)));
      const totalCardBalance = cardBalances.reduce((s, b) => s + b.balance, 0n);

      return {
        programId: p.id,
        slug: p.slug,
        name: p.name,
        currency: p.currency,
        floatBalance: floatBal?.balance.toString() ?? '0',
        totalCardBalance: totalCardBalance.toString(),
        liabilityBalance: liabilityBal?.balance.toString() ?? '0',
        activeCards: cardAccounts.length,
        asOf: new Date().toISOString(),
      };
    }));

    res.json({ data: rows, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Issuance report ───────────────────────────────────────────────────────────
reportsRouter.get('/issuance', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = dateRangeSchema.parse(req.query);
    const programId = req.user!.role === 'SUPER_ADMIN' ? input.programId : req.user!.programId!;

    const cards = await prismaRead.card.findMany({
      where: {
        programId: programId ?? undefined,
        createdAt: { gte: input.startDate, lte: input.endDate },
      },
      select: {
        id: true, cardType: true, currency: true, initialLoad: true, status: true,
        createdAt: true, activatedAt: true, campaignId: true, departmentId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const summary = {
      totalCards: cards.length,
      totalLoadedCents: cards.reduce((s, c) => s + c.initialLoad, 0n).toString(),
      byType: {
        VIRTUAL: cards.filter((c) => c.cardType === 'VIRTUAL').length,
        PHYSICAL: cards.filter((c) => c.cardType === 'PHYSICAL').length,
        SINGLE_USE: cards.filter((c) => c.cardType === 'SINGLE_USE').length,
      },
      byStatus: {
        ACTIVE: cards.filter((c) => c.status === 'ACTIVE').length,
        PENDING_ACTIVATION: cards.filter((c) => c.status === 'PENDING_ACTIVATION').length,
        CANCELLED: cards.filter((c) => c.status === 'CANCELLED').length,
        EXPIRED: cards.filter((c) => c.status === 'EXPIRED').length,
      },
      period: { startDate: input.startDate, endDate: input.endDate },
    };

    res.json({ data: { summary, cards }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Redemption report ─────────────────────────────────────────────────────────
reportsRouter.get('/redemption', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = dateRangeSchema.parse(req.query);
    const programId = req.user!.role === 'SUPER_ADMIN' ? input.programId : req.user!.programId!;

    const auths = await prismaRead.authorization.findMany({
      where: {
        programId: programId ?? undefined,
        status: { in: ['CAPTURED', 'PARTIALLY_CAPTURED', 'REVERSED'] },
        capturedAt: { gte: input.startDate, lte: input.endDate },
      },
      select: {
        id: true, capturedAmount: true, reversedAmount: true, currency: true,
        merchantMcc: true, merchantCountry: true, capturedAt: true,
      },
      take: 10000,
    });

    const totalRedemptions = auths.reduce((s, a) => s + a.capturedAmount - a.reversedAmount, 0n);
    const summary = {
      totalTransactions: auths.length,
      totalRedemptionsCents: totalRedemptions.toString(),
      avgTransactionCents: auths.length > 0 ? (totalRedemptions / BigInt(auths.length)).toString() : '0',
      period: { startDate: input.startDate, endDate: input.endDate },
    };

    res.json({ data: { summary, transactions: auths }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Dormancy report ───────────────────────────────────────────────────────────
reportsRouter.get('/dormancy', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const assessments = await prismaRead.dormancyAssessment.findMany({
      where: {
        programId: programId ?? undefined,
        assessedAt: {
          gte: req.query['startDate'] ? new Date(req.query['startDate'] as string) : new Date(Date.now() - 90 * 86400000),
        },
      },
      orderBy: { assessedAt: 'desc' },
      take: 1000,
      include: { card: { select: { id: true, last4: true } } },
    });
    const totalFees = assessments.reduce((s, a) => s + a.feeAmount, 0n);
    res.json({ data: { assessments, totalFeesCents: totalFees.toString() }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── Escheatment report ────────────────────────────────────────────────────────
reportsRouter.get('/escheatment', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const programId = req.user!.role === 'SUPER_ADMIN' ? req.query['programId'] as string | undefined : req.user!.programId!;
    const records = await prismaRead.escheatmentRecord.findMany({
      where: {
        programId: programId ?? undefined,
        stateCode: req.query['stateCode'] as string | undefined,
        status: req.query['status'] as string | undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { card: { select: { id: true, last4: true } } },
    });
    const totalAmount = records.reduce((s, r) => s + r.amount, 0n);
    res.json({ data: { records, totalAmountCents: totalAmount.toString(), count: records.length }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});

// ─── GL export ─────────────────────────────────────────────────────────────────
reportsRouter.get('/gl-export', authenticate, authorize('SUPER_ADMIN', 'PROGRAM_ADMIN', 'AUDITOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = dateRangeSchema.parse(req.query);
    const programId = req.user!.role === 'SUPER_ADMIN' ? input.programId : req.user!.programId!;
    if (!programId) throw new AppError(400, 'PROGRAM_REQUIRED', 'programId is required for GL export');

    const [entries, mappings] = await Promise.all([
      prismaRead.journalEntry.findMany({
        where: {
          programId,
          status: 'POSTED',
          postedAt: { gte: input.startDate, lte: input.endDate },
        },
        include: { lines: { include: { account: { select: { id: true, accountType: true, label: true } } } } },
        orderBy: { postedAt: 'asc' },
        take: 5000,
      }),
      prismaRead.glMapping.findMany({ where: { programId } }),
    ]);

    const mappingMap = new Map(mappings.map((m) => [m.accountType, m]));

    const glLines = entries.flatMap((entry) =>
      entry.lines.map((line) => {
        const mapping = mappingMap.get(line.account.accountType);
        return {
          entryId: entry.id,
          entryType: entry.entryType,
          postedAt: entry.postedAt,
          description: entry.description,
          accountId: line.accountId,
          accountLabel: line.account.label,
          accountType: line.account.accountType,
          glAccountCode: mapping?.glAccountCode ?? 'UNMAPPED',
          glDescription: mapping?.glDescription ?? line.account.label,
          direction: line.direction,
          amountCents: line.amount.toString(),
          currency: line.currency,
        };
      })
    );

    res.json({ data: { lines: glLines, programId, period: { startDate: input.startDate, endDate: input.endDate } }, meta: { requestId: req.requestId } });
  } catch (err) { next(err); }
});
