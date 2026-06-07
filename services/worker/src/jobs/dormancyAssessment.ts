import { prismaRead, prisma } from '../../../api/src/shared/db/prisma';
import { getBalance, postDormancyFee } from '../../../api/src/modules/ledger/ledger.service';
import { logger } from '../../../api/src/shared/utils/logger';

export async function runDormancyAssessment(): Promise<void> {
  const programs = await prismaRead.program.findMany({
    where: { status: 'ACTIVE', dormancyFeeCents: { gt: 0n } },
    select: { id: true, dormancyFeeCents: true, dormancyMonths: true, feeAccountId: true, currency: true },
  });

  for (const program of programs) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - program.dormancyMonths);

    const dormantCards = await prismaRead.card.findMany({
      where: { programId: program.id, status: 'ACTIVE', lastUsedAt: { lt: cutoff } },
      select: { id: true, accountId: true, currency: true },
      take: 500,
    });

    for (const card of dormantCards) {
      try {
        const thisMonthStart = new Date();
        thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
        const recentFee = await prismaRead.dormancyAssessment.findFirst({
          where: { cardId: card.id, assessedAt: { gte: thisMonthStart } },
        });
        if (recentFee) continue;

        const { balance } = await getBalance(card.accountId);
        if (balance <= 0n) continue;

        const feeAmount = balance < program.dormancyFeeCents ? balance : program.dormancyFeeCents;

        await prisma.$transaction(async (tx) => {
          const entry = await postDormancyFee({
            cardId: card.id, programId: program.id,
            cardAccountId: card.accountId, feeAccountId: program.feeAccountId!,
            amount: feeAmount, currency: card.currency,
            idempotencyKey: `dormancy:${card.id}:${thisMonthStart.toISOString().slice(0,7)}`, tx,
          });
          await tx.dormancyAssessment.create({
            data: {
              cardId: card.id, programId: program.id,
              dormantSince: cutoff, feeAmount, currency: card.currency,
              monthsDormant: program.dormancyMonths, entryId: entry.entryId,
            },
          });
        });
      } catch (err) {
        logger.error('Dormancy fee failed', { cardId: card.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
