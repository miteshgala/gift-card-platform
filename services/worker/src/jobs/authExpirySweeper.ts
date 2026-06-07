/**
 * Authorization Expiry Sweeper
 * Runs every 15 minutes. Finds PENDING authorizations past their expires_at
 * and voids them, releasing the hold back to the card balance.
 */

import { prisma, prismaRead } from '../../../api/src/shared/db/prisma';
import { postVoid } from '../../../api/src/modules/ledger/ledger.service';
import { logger } from '../../../api/src/shared/utils/logger';

export async function runAuthExpirySweeper(): Promise<void> {
  const expired = await prismaRead.authorization.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    select: {
      id: true, programId: true, cardId: true, accountId: true,
      authorizedAmount: true, capturedAmount: true, currency: true,
    },
    take: 1000, // Process in batches
  });

  if (expired.length === 0) return;

  logger.info(`Auth expiry sweeper: voiding ${expired.length} expired authorizations`);

  for (const auth of expired) {
    try {
      const authHoldAccount = await prismaRead.account.findFirst({
        where: { cardId: auth.cardId, accountType: 'AUTH_HOLD' },
        select: { id: true },
      });
      if (!authHoldAccount) continue;

      const holdAmount = auth.authorizedAmount - auth.capturedAmount;
      if (holdAmount <= 0n) {
        await prisma.authorization.update({ where: { id: auth.id }, data: { status: 'EXPIRED', voidedAt: new Date() } });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await postVoid({
          authorizationId: auth.id,
          programId: auth.programId,
          authHoldAccountId: authHoldAccount.id,
          cardAccountId: auth.accountId,
          amount: holdAmount,
          currency: auth.currency,
          tx,
        });
        await tx.authorization.update({ where: { id: auth.id }, data: { status: 'EXPIRED', voidedAt: new Date() } });
      });
    } catch (err) {
      logger.error('Failed to void expired auth', { authId: auth.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
