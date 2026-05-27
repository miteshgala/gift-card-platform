import crypto from 'crypto';
import { WebhookEvent, WebhookDeliveryStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { generateSecureToken, hashApiKey } from '../../utils/crypto';

// ─── Create Webhook Endpoint ──────────────────────────────────────────────────

export async function createWebhookEndpoint(input: {
  programId: string;
  url: string;
  events: WebhookEvent[];
  description?: string;
}) {
  const secret = generateSecureToken(32);
  const secretHash = hashApiKey(secret);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      programId: input.programId,
      url: input.url,
      secretHash,
      events: input.events,
      description: input.description,
    },
  });

  // Return the secret only once
  return { endpoint, secret };
}

// ─── Dispatch Webhook ─────────────────────────────────────────────────────────

export async function dispatchWebhook(
  programId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  cardId?: string
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { programId, isActive: true, events: { has: event } },
  });

  for (const endpoint of endpoints) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        cardId,
        event,
        payload: payload as Prisma.InputJsonValue,
        status: WebhookDeliveryStatus.PENDING,
      },
    });

    // Attempt delivery (retry via job queue in production)
    deliverWebhook(delivery.id, endpoint.url, endpoint.secretHash, payload).catch(() => {});
  }
}

async function deliverWebhook(
  deliveryId: string,
  url: string,
  secretHash: string,
  payload: Record<string, unknown>
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secretHash)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMessage: string | undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GiftCard-Signature': `t=${timestamp},v1=${signature}`,
        'X-GiftCard-Event': payload['event'] as string,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = await res.text().catch(() => '');

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: res.ok ? WebhookDeliveryStatus.SUCCESS : WebhookDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        responseStatus,
        responseBody: responseBody?.slice(0, 1000),
      },
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Webhook delivery failed', { deliveryId, url, error: errorMessage });

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        errorMessage,
      },
    });
  }
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

import { generateApiKeyValue, hashApiKey as hashKey } from '../../utils/crypto';

export async function createApiKey(input: {
  programId: string;
  name: string;
  isSandbox: boolean;
  expiresAt?: Date;
}) {
  const { key, prefix } = generateApiKeyValue(input.isSandbox);
  const keyHash = hashKey(key);

  const apiKey = await prisma.apiKey.create({
    data: {
      programId: input.programId,
      name: input.name,
      keyHash,
      keyPrefix: prefix,
      isSandbox: input.isSandbox,
      expiresAt: input.expiresAt,
    },
  });

  return { apiKey, key }; // key returned only once
}

export async function revokeApiKey(keyId: string, programId: string) {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key || key.programId !== programId) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found');
  return prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });
}

export async function listApiKeys(programId: string) {
  return prisma.apiKey.findMany({
    where: { programId },
    select: {
      id: true, name: true, keyPrefix: true, isSandbox: true,
      isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listWebhookEndpoints(programId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { programId },
    select: {
      id: true, url: true, events: true, isActive: true, description: true, createdAt: true,
    },
  });
}

export async function deleteWebhookEndpoint(endpointId: string, programId: string) {
  const ep = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!ep || ep.programId !== programId) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'Webhook endpoint not found');
  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
}
