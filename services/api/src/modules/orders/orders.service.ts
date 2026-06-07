/**
 * Orders Service
 * Bulk card issuance workflow with approval gates.
 *
 * Order states:
 *   PENDING → PENDING_APPROVAL (if above approval threshold) → PROCESSING → COMPLETED / FAILED
 *   PENDING → PROCESSING (if below auto-approve limit)
 */

import { prisma, prismaRead } from '../../shared/db/prisma';
import { AppError } from '../../shared/errors/AppError';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Prisma } from '@prisma/client';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const issuanceQueue = new Queue('card-issuance', {
  // Cast needed: BullMQ bundles its own ioredis version; types are structurally compatible at runtime
  connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) as never,
});

export interface CreateOrderInput {
  programId: string;
  campaignId?: string;
  currency: string;
  lineItems: Array<{
    recipientName?: string;
    recipientEmail?: string;
    recipientPhone?: string;
    amountCents: bigint;
    cardType?: string;
  }>;
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export async function createOrder(input: CreateOrderInput) {
  const program = await prismaRead.program.findUnique({
    where: { id: input.programId },
    select: { id: true, status: true, approvalThreshold: true, autoApproveLimit: true, budgetCap: true, currency: true },
  });
  if (!program) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
  if (program.status !== 'ACTIVE') throw new AppError(422, 'PROGRAM_SUSPENDED', 'Program is suspended');

  const totalAmountCents = input.lineItems.reduce((sum, li) => sum + li.amountCents, 0n);
  const totalCards = input.lineItems.length;

  if (totalCards === 0) throw new AppError(400, 'EMPTY_ORDER', 'Order must have at least one line item');
  if (totalCards > 10000) throw new AppError(400, 'ORDER_TOO_LARGE', 'Maximum 10,000 cards per order');

  // Determine initial status
  const needsApproval = totalAmountCents >= program.approvalThreshold;
  const initialStatus = needsApproval ? 'PENDING_APPROVAL' : 'PENDING';

  const order = await prisma.order.create({
    data: {
      programId: input.programId,
      campaignId: input.campaignId ?? null,
      status: initialStatus,
      totalCards,
      totalAmountCents,
      currency: input.currency,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      lineItems: {
        createMany: {
          data: input.lineItems.map((li) => ({
            recipientName: li.recipientName ?? null,
            recipientEmail: li.recipientEmail ?? null,
            recipientPhone: li.recipientPhone ?? null,
            amountCents: li.amountCents,
            cardType: li.cardType ?? 'VIRTUAL',
            status: 'PENDING',
          })),
        },
      },
    },
    include: { lineItems: true },
  });

  // If auto-approvable, immediately enqueue
  if (!needsApproval) {
    await enqueueOrderProcessing(order.id);
  }

  return order;
}

export async function approveOrder(orderId: string, approvedBy: string) {
  const order = await prismaRead.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.status !== 'PENDING_APPROVAL') throw new AppError(422, 'INVALID_STATE', `Order cannot be approved from status ${order.status}`);

  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'PENDING', approvedBy, approvedAt: new Date() },
  });

  await enqueueOrderProcessing(orderId);
  return { orderId, status: 'PENDING' };
}

export async function cancelOrder(orderId: string, programId?: string) {
  const order = await prismaRead.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (programId && order.programId !== programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  if (!['PENDING', 'PENDING_APPROVAL'].includes(order.status)) {
    throw new AppError(422, 'INVALID_STATE', 'Only pending orders can be cancelled');
  }
  return prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
}

export async function getOrder(orderId: string, programId?: string) {
  const order = await prismaRead.order.findUnique({
    where: { id: orderId },
    include: { lineItems: { take: 100 } },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (programId && order.programId !== programId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  return order;
}

export async function listOrders(programId: string | undefined, opts: { status?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const items = await prismaRead.order.findMany({
    where: { programId: programId ?? undefined, status: opts.status ?? undefined },
    take: limit + 1,
    cursor: opts.cursor ? { id: opts.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, programId: true, status: true, totalCards: true, processedCards: true,
      failedCards: true, totalAmountCents: true, currency: true, createdAt: true, approvedAt: true,
    },
  });
  const hasMore = items.length > limit;
  return { items: hasMore ? items.slice(0, limit) : items, hasMore, nextCursor: hasMore ? items[limit - 1]?.id : undefined };
}

async function enqueueOrderProcessing(orderId: string) {
  // Update order to PROCESSING
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'PROCESSING' },
    include: { lineItems: { where: { status: 'PENDING' }, select: { id: true } } },
  });

  // Enqueue each line item individually for parallel processing
  const jobs = order.lineItems.map((li) => ({
    name: 'card-issuance',
    data: { orderId, lineItemId: li.id },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  }));

  if (jobs.length > 0) {
    await issuanceQueue.addBulk(jobs);
  }
}
