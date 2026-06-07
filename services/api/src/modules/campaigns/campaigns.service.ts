/**
 * Campaigns Service
 * Promotional campaigns with optional bonus loads and card limits.
 */

import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';

export interface CreateCampaignInput {
  programId: string;
  name: string;
  description?: string;
  bonusLoadPercent?: number;
  expiryDays?: number;
  maxCards?: number;
  startsAt?: Date;
  endsAt?: Date;
  metadata?: Record<string, unknown>;
}

export async function createCampaign(input: CreateCampaignInput) {
  // Validate program exists
  const program = await prismaRead.program.findUnique({ where: { id: input.programId }, select: { id: true, status: true } });
  if (!program) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
  if (program.status !== 'ACTIVE') throw new AppError(422, 'PROGRAM_SUSPENDED', 'Cannot create campaign for suspended program');

  return prisma.campaign.create({
    data: {
      programId: input.programId,
      name: input.name,
      description: input.description ?? null,
      bonusLoadPercent: input.bonusLoadPercent ?? null,
      expiryDays: input.expiryDays ?? null,
      maxCards: input.maxCards ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      metadata: (input.metadata ?? {}) as unknown as import('@prisma/client').Prisma.InputJsonValue,
      status: 'ACTIVE',
    },
  });
}

export async function listCampaigns(programId: string, opts: { status?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const items = await prismaRead.campaign.findMany({
    where: { programId, status: opts.status ?? undefined },
    take: limit + 1,
    cursor: opts.cursor ? { id: opts.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { cards: true } } },
  });
  const hasMore = items.length > limit;
  return { items: hasMore ? items.slice(0, limit) : items, hasMore, nextCursor: hasMore ? items[limit - 1]?.id : undefined };
}

export async function getCampaign(id: string, programId?: string) {
  const campaign = await prismaRead.campaign.findUnique({
    where: { id },
    include: { _count: { select: { cards: true } } },
  });
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
  if (programId && campaign.programId !== programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  return campaign;
}

export async function updateCampaign(id: string, programId: string | undefined, input: Partial<CreateCampaignInput>) {
  await getCampaign(id, programId);
  return prisma.campaign.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      bonusLoadPercent: input.bonusLoadPercent,
      expiryDays: input.expiryDays,
      maxCards: input.maxCards,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      metadata: input.metadata as unknown as import('@prisma/client').Prisma.InputJsonValue | undefined,
    },
  });
}

export async function deactivateCampaign(id: string, programId?: string) {
  await getCampaign(id, programId);
  return prisma.campaign.update({ where: { id }, data: { status: 'INACTIVE' } });
}
