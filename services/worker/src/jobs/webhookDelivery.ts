import { prisma, prismaRead } from '../../../api/src/shared/db/prisma';
import { decrypt, hmacSha256 } from '../../../api/src/shared/utils/crypto';
import { logger } from '../../../api/src/shared/utils/logger';

const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 28800, 86400];

export async function runWebhookDelivery(deliveryId: string): Promise<void> {
  const delivery = await prismaRead.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === 'SUCCESS' || delivery.status === 'EXHAUSTED') return;

  const secret = decrypt(delivery.endpoint.secret);
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = hmacSha256(secret, `${timestamp}.${body}`);

  try {
    const response = await fetch(delivery.endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GiftCard-Signature': `sha256=${signature}`,
        'X-GiftCard-Timestamp': timestamp,
        'X-GiftCard-Event': delivery.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const success = response.status >= 200 && response.status < 300;
    const responseBody = await response.text().catch(() => '');

    if (success) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SUCCESS', lastHttpStatus: response.status, lastResponseBody: responseBody.slice(0, 1000), attemptCount: { increment: 1 } },
      });
      return;
    }

    throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 200)}`);
  } catch (err) {
    const newAttemptCount = delivery.attemptCount + 1;
    const exhausted = newAttemptCount >= RETRY_DELAYS_SECONDS.length;
    const nextDelay = RETRY_DELAYS_SECONDS[Math.min(newAttemptCount, RETRY_DELAYS_SECONDS.length - 1)];

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: exhausted ? 'EXHAUSTED' : 'FAILED',
        attemptCount: newAttemptCount,
        lastResponseBody: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
        nextAttemptAt: exhausted ? null : new Date(Date.now() + (nextDelay ?? 60) * 1000),
      },
    });

    logger.warn('Webhook delivery failed', { deliveryId, attempt: newAttemptCount, exhausted });
    if (!exhausted) throw err; // BullMQ will retry
  }
}
