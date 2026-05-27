import Bull from 'bull';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { WebhookDeliveryStatus } from '@prisma/client';

// ─── Retry delays: 30s, 2m, 10m, 1h, 6h ─────────────────────────────────────
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export interface WebhookJobData {
  deliveryId: string;
  url: string;
  secretHash: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export const webhookQueue = new Bull<WebhookJobData>('webhook-delivery', env.REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: 100, // keep last 100 completed
    removeOnFail: false,
  },
});

// ─── Processor ────────────────────────────────────────────────────────────────

webhookQueue.process(async (job) => {
  const { deliveryId, url, secretHash, payload, attempt } = job.data;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secretHash)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMessage: string | undefined;
  let succeeded = false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GiftCard-Signature': `t=${timestamp},v1=${signature}`,
        'X-GiftCard-Event': String(payload['event'] ?? ''),
        'X-GiftCard-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    responseStatus = res.status;
    responseBody = (await res.text().catch(() => '')).slice(0, 1000);
    succeeded = res.ok;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }

  const nextAttempt = attempt + 1;
  const hasMoreRetries = nextAttempt < MAX_ATTEMPTS;

  if (succeeded) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.SUCCESS,
        attempts: nextAttempt,
        lastAttemptAt: new Date(),
        responseStatus,
        responseBody,
        nextRetryAt: null,
      },
    });
    logger.info('Webhook delivered successfully', { deliveryId, url, attempt });
  } else {
    if (hasMoreRetries) {
      const delay = RETRY_DELAYS_MS[nextAttempt];
      const nextRetryAt = new Date(Date.now() + delay);

      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: WebhookDeliveryStatus.RETRYING,
          attempts: nextAttempt,
          lastAttemptAt: new Date(),
          nextRetryAt,
          responseStatus,
          responseBody,
          errorMessage,
        },
      });

      // Re-enqueue with delay
      await webhookQueue.add(
        { deliveryId, url, secretHash, payload, attempt: nextAttempt },
        { delay, jobId: `${deliveryId}-attempt-${nextAttempt}` }
      );

      logger.warn('Webhook delivery failed, retrying', {
        deliveryId, url, attempt: nextAttempt,
        delayMs: delay, nextRetryAt,
      });
    } else {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          attempts: nextAttempt,
          lastAttemptAt: new Date(),
          nextRetryAt: null,
          responseStatus,
          responseBody,
          errorMessage,
        },
      });
      logger.error('Webhook delivery permanently failed after max attempts', {
        deliveryId, url, attempts: nextAttempt,
      });
    }
  }
});

webhookQueue.on('failed', (job, err) => {
  logger.error('Webhook queue job threw unexpectedly', { jobId: job.id, error: err.message });
});
