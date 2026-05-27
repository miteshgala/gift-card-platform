import Bull from 'bull';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { CardStatus, LedgerEntryType, Prisma, WebhookEvent } from '@prisma/client';
import { dispatchWebhook } from '../modules/webhooks/webhooks.service';

// ─── Scheduler queue (repeatable jobs) ───────────────────────────────────────

export const schedulerQueue = new Bull('scheduler', env.REDIS_URL, {
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 },
});

const DORMANCY_FEE_AMOUNT = 2.50;   // $2.50/month — should be per-program config in v2
const DORMANCY_THRESHOLD_DAYS = 365; // cards inactive > 1 year

// ─── Register repeatable jobs ─────────────────────────────────────────────────

export async function startScheduler() {
  // Remove stale repeatable jobs on restart to avoid duplicates
  const existing = await schedulerQueue.getRepeatableJobs();
  for (const job of existing) {
    await schedulerQueue.removeRepeatableByKey(job.key);
  }

  await schedulerQueue.add('expiry-sweep', {}, {
    repeat: { cron: '0 1 * * *' }, // 1:00 AM daily
    jobId: 'expiry-sweep',
  });

  await schedulerQueue.add('dormancy-fee', {}, {
    repeat: { cron: '0 2 1 * *' }, // 2:00 AM on the 1st of each month
    jobId: 'dormancy-fee',
  });

  logger.info('Scheduler started', { jobs: ['expiry-sweep (daily)', 'dormancy-fee (monthly)'] });
}

// ─── Processor ────────────────────────────────────────────────────────────────

schedulerQueue.process('expiry-sweep', async (job) => {
  logger.info('Running expiry sweep');
  const now = new Date();

  // Find all ACTIVE or FROZEN cards that have passed their expiry date
  const expiredCards = await prisma.giftCard.findMany({
    where: {
      status: { in: [CardStatus.ACTIVE, CardStatus.FROZEN] },
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      programId: true,
      currentBalance: true,
      currency: true,
      status: true,
    },
    take: 1000, // process in batches; re-runs daily so stragglers are caught next run
  });

  if (expiredCards.length === 0) {
    logger.info('Expiry sweep: no expired cards found');
    return { expired: 0 };
  }

  let expired = 0;
  for (const card of expiredCards) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.giftCard.update({
          where: { id: card.id },
          data: { status: CardStatus.EXPIRED },
        });

        // Write a $0 ledger marker so the audit trail shows when expiry occurred
        if (card.currentBalance.gt(0)) {
          await tx.ledgerEntry.create({
            data: {
              cardId: card.id,
              type: LedgerEntryType.ADJUSTMENT,
              amount: new Prisma.Decimal(0),
              balanceBefore: card.currentBalance,
              balanceAfter: card.currentBalance,
              currency: card.currency,
              description: 'Card expired — balance forfeited per program terms',
            },
          });
        }

        await tx.auditLog.create({
          data: {
            action: 'CARD_EXPIRE',
            resourceType: 'GiftCard',
            resourceId: card.id,
            diff: { previousStatus: card.status, balance: card.currentBalance.toString() },
          },
        });
      });

      // Fire webhook outside the transaction (non-blocking)
      dispatchWebhook(card.programId, WebhookEvent.CARD_EXPIRED, {
        event: WebhookEvent.CARD_EXPIRED,
        cardId: card.id,
        expiredAt: now.toISOString(),
        forfeitedBalance: card.currentBalance.toString(),
        currency: card.currency,
      }, card.id).catch((err) =>
        logger.error('Failed to dispatch CARD_EXPIRED webhook', { cardId: card.id, error: err.message })
      );

      expired++;
    } catch (err) {
      logger.error('Failed to expire card', {
        cardId: card.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    await job.progress(Math.round((expired / expiredCards.length) * 100));
  }

  logger.info('Expiry sweep complete', { expired, total: expiredCards.length });
  return { expired, total: expiredCards.length };
});

schedulerQueue.process('dormancy-fee', async (job) => {
  logger.info('Running dormancy fee sweep');
  const dormantThreshold = new Date(Date.now() - DORMANCY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const fee = new Prisma.Decimal(DORMANCY_FEE_AMOUNT);

  // Find ACTIVE cards with balance > fee that haven't transacted in over a year
  const dormantCards = await prisma.giftCard.findMany({
    where: {
      status: CardStatus.ACTIVE,
      currentBalance: { gt: fee },
      OR: [
        { lastTransactionAt: { lt: dormantThreshold } },
        { lastTransactionAt: null, activatedAt: { lt: dormantThreshold } },
      ],
    },
    select: {
      id: true,
      programId: true,
      currentBalance: true,
      currency: true,
      lastTransactionAt: true,
    },
    take: 1000,
  });

  if (dormantCards.length === 0) {
    logger.info('Dormancy fee sweep: no dormant cards found');
    return { charged: 0 };
  }

  let charged = 0;
  for (const card of dormantCards) {
    try {
      const balanceBefore = card.currentBalance;
      const balanceAfter = balanceBefore.sub(fee);

      await prisma.$transaction(async (tx) => {
        await tx.ledgerEntry.create({
          data: {
            cardId: card.id,
            type: LedgerEntryType.EXPIRY_FEE,
            amount: fee,
            balanceBefore,
            balanceAfter,
            currency: card.currency,
            description: `Monthly dormancy fee — card inactive for ${DORMANCY_THRESHOLD_DAYS}+ days`,
          },
        });

        await tx.giftCard.update({
          where: { id: card.id },
          data: { currentBalance: balanceAfter, lastTransactionAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            action: 'LEDGER_ADJUSTMENT',
            resourceType: 'GiftCard',
            resourceId: card.id,
            diff: {
              type: 'DORMANCY_FEE',
              fee: DORMANCY_FEE_AMOUNT,
              balanceBefore: balanceBefore.toString(),
              balanceAfter: balanceAfter.toString(),
            },
          },
        });
      });

      charged++;
    } catch (err) {
      logger.error('Failed to apply dormancy fee', {
        cardId: card.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    await job.progress(Math.round((charged / dormantCards.length) * 100));
  }

  logger.info('Dormancy fee sweep complete', { charged, total: dormantCards.length });
  return { charged, total: dormantCards.length };
});

// ─── Event handlers ───────────────────────────────────────────────────────────

schedulerQueue.on('completed', (job, result) => {
  logger.info(`Scheduler job completed: ${job.name}`, { result });
});

schedulerQueue.on('failed', (job, err) => {
  logger.error(`Scheduler job failed: ${job.name}`, { error: err.message });
});
