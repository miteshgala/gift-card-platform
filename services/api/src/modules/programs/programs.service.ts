/**
 * Programs Service
 * CRUD + account bootstrapping for gift card programs.
 */

import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { bootstrapProgramAccounts } from '../ledger/ledger.service';
import { publish, TOPICS } from '../../shared/kafka/client';
import type { Prisma } from '@prisma/client';

export interface CreateProgramInput {
  slug: string;
  name: string;
  description?: string;
  currency?: string;
  openLoop?: boolean;
  cardExpiryDays?: number;
  dormancyFeeCents?: bigint;
  dormancyMonths?: number;
  budgetCap?: bigint;
  approvalThreshold?: bigint;
  autoApproveLimit?: bigint;
  kycRequiredAbove?: bigint;
  ownerPartyId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProgramInput {
  name?: string;
  description?: string;
  dormancyFeeCents?: bigint;
  dormancyMonths?: number;
  budgetCap?: bigint;
  approvalThreshold?: bigint;
  autoApproveLimit?: bigint;
  kycRequiredAbove?: bigint;
  metadata?: Record<string, unknown>;
}

export async function createProgram(input: CreateProgramInput) {
  // Check slug uniqueness
  const existing = await prismaRead.program.findUnique({ where: { slug: input.slug } });
  if (existing) throw new AppError(409, 'SLUG_TAKEN', `Program slug '${input.slug}' is already in use`);

  // Create program + bootstrap ledger accounts atomically
  const program = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.program.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        currency: input.currency ?? 'USD',
        openLoop: input.openLoop ?? false,
        cardExpiryDays: input.cardExpiryDays ?? 1825,
        dormancyFeeCents: input.dormancyFeeCents ?? 0n,
        dormancyMonths: input.dormancyMonths ?? 12,
        budgetCap: input.budgetCap ?? null,
        approvalThreshold: input.approvalThreshold ?? 500000n,
        autoApproveLimit: input.autoApproveLimit ?? 100000n,
        kycRequiredAbove: input.kycRequiredAbove ?? null,
        ownerPartyId: input.ownerPartyId ?? null,
        metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        status: 'ACTIVE',
      },
    });
    // Bootstrap the 5 program-level accounts (FLOAT, LIABILITY_RESERVE, BREAKAGE, FEE_INCOME, ESCROW)
    await bootstrapProgramAccounts(created.id, created.currency, tx);
    return created;
  });

  await publish({
    topic: TOPICS.CARD_EVENTS,
    key: program.id,
    value: { event: 'program.created', programId: program.id },
  });

  // Return fresh record with account IDs populated
  return prismaRead.program.findUniqueOrThrow({ where: { id: program.id } });
}

export async function listPrograms(opts: { status?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const items = await prismaRead.program.findMany({
    where: { status: opts.status ?? undefined },
    take: limit + 1,
    cursor: opts.cursor ? { id: opts.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, slug: true, name: true, currency: true, status: true,
      openLoop: true, cardExpiryDays: true, budgetCap: true,
      floatAccountId: true, createdAt: true,
    },
  });
  const hasMore = items.length > limit;
  return { items: hasMore ? items.slice(0, limit) : items, hasMore, nextCursor: hasMore ? items[limit - 1]?.id : undefined };
}

export async function getProgram(id: string) {
  const program = await prismaRead.program.findUnique({
    where: { id },
    include: { _count: { select: { cards: true, users: true, campaigns: true } } },
  });
  if (!program) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
  return program;
}

export async function updateProgram(id: string, input: UpdateProgramInput) {
  await getProgram(id); // validates existence
  return prisma.program.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      dormancyFeeCents: input.dormancyFeeCents,
      dormancyMonths: input.dormancyMonths,
      budgetCap: input.budgetCap,
      approvalThreshold: input.approvalThreshold,
      autoApproveLimit: input.autoApproveLimit,
      kycRequiredAbove: input.kycRequiredAbove,
      metadata: input.metadata as unknown as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function suspendProgram(id: string) {
  const program = await getProgram(id);
  if (program.status === 'SUSPENDED') return;
  return prisma.program.update({ where: { id }, data: { status: 'SUSPENDED' } });
}

export async function activateProgram(id: string) {
  const program = await getProgram(id);
  if (program.status === 'ACTIVE') return;
  return prisma.program.update({ where: { id }, data: { status: 'ACTIVE' } });
}

export async function getProgramReconciliation(programId: string) {
  const logs = await prismaRead.reconciliationLog.findMany({
    where: { programId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return logs;
}
