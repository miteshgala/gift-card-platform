import { prisma } from '../../../api/src/shared/db/prisma';
import { issueCard } from '../../../api/src/modules/cards/cards.service';
import { logger } from '../../../api/src/shared/utils/logger';

export async function runCardIssuance(orderId: string, lineItemId: string): Promise<void> {
  const lineItem = await prisma.orderLineItem.findUnique({
    where: { id: lineItemId },
    include: { order: { select: { programId: true, campaignId: true, currency: true } } },
  });
  if (!lineItem || lineItem.status !== 'PENDING') return;

  try {
    const { cardId } = await issueCard({
      programId: lineItem.order.programId,
      campaignId: lineItem.order.campaignId ?? undefined,
      cardType: lineItem.cardType as 'VIRTUAL' | 'PHYSICAL' | 'SINGLE_USE',
      amountCents: lineItem.amountCents,
      currency: lineItem.order.currency,
      recipientName: lineItem.recipientName ?? undefined,
      recipientEmail: lineItem.recipientEmail ?? undefined,
      recipientPhone: lineItem.recipientPhone ?? undefined,
      pin: '0000', // Default PIN — recipient must change on first use
      orderId,
    });

    await prisma.orderLineItem.update({
      where: { id: lineItemId },
      data: { status: 'ISSUED', cardId },
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { processedCards: { increment: 1 } },
    });
  } catch (err) {
    logger.error('Card issuance job failed', { lineItemId, error: err instanceof Error ? err.message : String(err) });
    await prisma.orderLineItem.update({
      where: { id: lineItemId },
      data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Unknown error' },
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { failedCards: { increment: 1 } },
    });
  }
}
