import { FraudSeverity, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { buildMeta, getPrismaSkip } from '../../utils/pagination';

// ─── Velocity Check ───────────────────────────────────────────────────────────

export interface VelocityCheckInput {
  cardId: string;
  programId: string;
  amount: number;
  recipientEmail?: string;
  location?: string;
}

export interface VelocityCheckResult {
  allowed: boolean;
  violations: string[];
  flags: Array<{ reason: string; severity: FraudSeverity }>;
}

export async function checkVelocity(input: VelocityCheckInput): Promise<VelocityCheckResult> {
  const rules = await prisma.velocityRule.findMany({
    where: { programId: input.programId, isActive: true },
  });

  if (rules.length === 0) return { allowed: true, violations: [], flags: [] };

  const violations: string[] = [];
  const flags: Array<{ reason: string; severity: FraudSeverity }> = [];

  for (const rule of rules) {
    const windowStart = new Date(Date.now() - rule.windowSeconds * 1000);

    let whereClause: Prisma.LedgerEntryWhereInput = {
      type: 'REDEEM',
      createdAt: { gte: windowStart },
    };

    if (rule.scope === 'card') {
      whereClause.cardId = input.cardId;
    } else if (rule.scope === 'program') {
      whereClause.card = { programId: input.programId };
    } else if (rule.scope === 'email' && input.recipientEmail) {
      whereClause.card = { recipientEmail: input.recipientEmail };
    }

    const [aggResult, countResult] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: whereClause,
        _sum: { amount: true },
        _count: { id: true },
      }),
      Promise.resolve(null),
    ]);

    const totalAmount = Number(aggResult._sum.amount ?? 0) + input.amount;
    const totalCount = aggResult._count.id + 1;

    if (rule.maxAmount && new Prisma.Decimal(totalAmount).gt(rule.maxAmount)) {
      const windowHours = rule.windowSeconds / 3600;
      const msg = `${rule.name}: Amount limit $${rule.maxAmount} exceeded in ${windowHours}h window`;
      violations.push(msg);
      flags.push({ reason: msg, severity: FraudSeverity.HIGH });
    }

    if (rule.maxCount && totalCount > rule.maxCount) {
      const windowHours = rule.windowSeconds / 3600;
      const msg = `${rule.name}: Transaction count limit ${rule.maxCount} exceeded in ${windowHours}h window`;
      violations.push(msg);
      flags.push({ reason: msg, severity: FraudSeverity.MEDIUM });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    flags,
  };
}

// ─── Geolocation Flagging ─────────────────────────────────────────────────────

export async function checkGeolocation(
  cardId: string,
  currentLocation: string | undefined
): Promise<{ suspicious: boolean; reason?: string }> {
  if (!currentLocation) return { suspicious: false };

  const card = await prisma.giftCard.findUnique({
    where: { id: cardId },
    select: { lastLocation: true, lastTransactionAt: true },
  });

  if (!card || !card.lastLocation || card.lastLocation === currentLocation) {
    return { suspicious: false };
  }

  // Simple country-level change detection
  const lastCountry = card.lastLocation.split(',').pop()?.trim();
  const currentCountry = currentLocation.split(',').pop()?.trim();

  if (lastCountry && currentCountry && lastCountry !== currentCountry) {
    const hoursSinceLastTx = card.lastTransactionAt
      ? (Date.now() - card.lastTransactionAt.getTime()) / 3_600_000
      : 999;

    if (hoursSinceLastTx < 6) {
      return {
        suspicious: true,
        reason: `Rapid location change: ${card.lastLocation} → ${currentLocation} within ${hoursSinceLastTx.toFixed(1)}h`,
      };
    }
  }

  return { suspicious: false };
}

// ─── Create Fraud Flag ────────────────────────────────────────────────────────

export async function createFraudFlag(input: {
  cardId: string;
  reason: string;
  severity?: FraudSeverity;
  details?: Record<string, unknown>;
}) {
  const flag = await prisma.fraudFlag.create({
    data: {
      cardId: input.cardId,
      reason: input.reason,
      severity: input.severity ?? FraudSeverity.MEDIUM,
      details: input.details as Prisma.InputJsonValue,
    },
  });
  logger.warn('Fraud flag created', { cardId: input.cardId, reason: input.reason, severity: input.severity });
  return flag;
}

// ─── Resolve Fraud Flag ───────────────────────────────────────────────────────

export async function resolveFraudFlag(flagId: string, resolution: string, resolvedBy: string) {
  const flag = await prisma.fraudFlag.findUnique({ where: { id: flagId } });
  if (!flag) throw new AppError(404, 'FLAG_NOT_FOUND', 'Fraud flag not found');
  if (flag.resolvedAt) throw new AppError(409, 'ALREADY_RESOLVED', 'Flag is already resolved');

  return prisma.fraudFlag.update({
    where: { id: flagId },
    data: { resolvedAt: new Date(), resolvedBy, resolution },
  });
}

// ─── List Fraud Flags ─────────────────────────────────────────────────────────

export async function listFraudFlags(filters: {
  programId?: string;
  cardId?: string;
  severity?: FraudSeverity;
  resolved?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const where: Prisma.FraudFlagWhereInput = {
    ...(filters.cardId && { cardId: filters.cardId }),
    ...(filters.severity && { severity: filters.severity }),
    ...(filters.resolved !== undefined && {
      resolvedAt: filters.resolved ? { not: null } : null,
    }),
    ...(filters.programId && { card: { programId: filters.programId } }),
  };

  const [flags, total] = await Promise.all([
    prisma.fraudFlag.findMany({
      where,
      skip: getPrismaSkip(page, limit),
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        card: { select: { cardNumberMasked: true, programId: true } },
      },
    }),
    prisma.fraudFlag.count({ where }),
  ]);

  return { flags, meta: buildMeta(total, page, limit) };
}

// ─── Velocity Rule CRUD ───────────────────────────────────────────────────────

export async function createVelocityRule(input: {
  programId: string;
  name: string;
  windowSeconds: number;
  maxAmount?: number;
  maxCount?: number;
  scope?: string;
}) {
  return prisma.velocityRule.create({
    data: {
      programId: input.programId,
      name: input.name,
      windowSeconds: input.windowSeconds,
      maxAmount: input.maxAmount ? new Prisma.Decimal(input.maxAmount) : undefined,
      maxCount: input.maxCount,
      scope: input.scope ?? 'card',
    },
  });
}

export async function listVelocityRules(programId: string) {
  return prisma.velocityRule.findMany({
    where: { programId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteVelocityRule(ruleId: string, programId: string) {
  const rule = await prisma.velocityRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.programId !== programId) {
    throw new AppError(404, 'RULE_NOT_FOUND', 'Velocity rule not found');
  }
  await prisma.velocityRule.delete({ where: { id: ruleId } });
}
