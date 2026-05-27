import Bull from 'bull';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { issueCard } from '../modules/cards/cards.service';
import { sendEGiftCard } from '../modules/email/email.service';
import { CardType, OrderStatus, FulfillmentStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

export interface BulkIssuanceJobData {
  orderId: string;
  programId: string;
  campaignId?: string;
  denomination: number;
  currency: string;
  cardType: CardType;
  csvPath?: string;
  recipients?: Array<{ email: string; name?: string; denomination?: number }>;
}

export const issuanceQueue = new Bull<BulkIssuanceJobData>('card-issuance', env.REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// ─── Processor ────────────────────────────────────────────────────────────────

issuanceQueue.process(async (job) => {
  const { orderId, programId, campaignId, denomination, currency, cardType, csvPath, recipients: directRecipients } = job.data;

  logger.info('Processing bulk issuance job', { orderId, jobId: job.id });

  // Mark order as processing
  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.PROCESSING, jobId: String(job.id) },
  });

  // Resolve recipient list
  let recipients: Array<{ email?: string; name?: string; denomination?: number }> = [];

  if (csvPath && fs.existsSync(csvPath)) {
    const content = fs.readFileSync(csvPath, 'utf-8');
    recipients = parse(content, { columns: true, skip_empty_lines: true });
  } else if (directRecipients) {
    recipients = directRecipients;
  }

  let processed = 0;
  let failed = 0;
  const total = recipients.length;

  for (const recipient of recipients) {
    try {
      const cardDenomination = recipient.denomination ?? denomination;

      const { card, cardNumber, pin } = await issueCard({
        programId,
        campaignId,
        orderId,
        cardType,
        denomination: cardDenomination,
        initialBalance: cardDenomination,
        currency,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
      });

      // Send email for digital cards
      if (cardType === CardType.DIGITAL && recipient.email) {
        await sendEGiftCard({
          to: recipient.email,
          recipientName: recipient.name,
          cardNumber,
          pin,
          balance: cardDenomination,
          currency,
          cardNumberMasked: card.cardNumberMasked,
          expiresAt: card.expiresAt ?? undefined,
        });

        await prisma.orderItem.updateMany({
          where: { orderId, recipientEmail: recipient.email },
          data: { fulfillmentStatus: FulfillmentStatus.SENT, lastSentAt: new Date() },
        });
      }

      processed++;
      const progress = Math.round((processed / total) * 100);
      await job.progress(progress);

      // Update order progress
      await prisma.order.update({
        where: { id: orderId },
        data: { jobProgress: progress },
      });
    } catch (err) {
      failed++;
      logger.error('Failed to issue card for recipient', {
        orderId,
        email: recipient.email,
        error: err instanceof Error ? err.message : 'Unknown error',
      });

      if (recipient.email) {
        await prisma.orderItem.updateMany({
          where: { orderId, recipientEmail: recipient.email },
          data: {
            fulfillmentStatus: FulfillmentStatus.FAILED,
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
          },
        });
      }
    }
  }

  const finalStatus = failed === total ? OrderStatus.FAILED : OrderStatus.COMPLETED;
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: finalStatus,
      jobProgress: 100,
      completedAt: new Date(),
      failureReason: failed > 0 ? `${failed}/${total} cards failed` : null,
    },
  });

  logger.info('Bulk issuance completed', { orderId, processed, failed, total });
  return { processed, failed, total };
});

// ─── Event handlers ───────────────────────────────────────────────────────────

issuanceQueue.on('failed', async (job, err) => {
  logger.error('Issuance job failed', { jobId: job.id, error: err.message });
  await prisma.order.update({
    where: { id: job.data.orderId },
    data: { status: OrderStatus.FAILED, failureReason: err.message },
  }).catch(() => {});
});

issuanceQueue.on('completed', (job, result) => {
  logger.info('Issuance job completed', { jobId: job.id, result });
});
