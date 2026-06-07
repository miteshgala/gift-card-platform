import { prismaRead, prisma } from '../../../api/src/shared/db/prisma';
import { logger } from '../../../api/src/shared/utils/logger';

const STATE_DORMANCY_YEARS: Record<string, number> = {
  AL:3,AK:3,AZ:3,AR:3,CA:3,CO:3,CT:3,DE:5,FL:3,GA:3,HI:3,ID:3,IL:3,IN:3,IA:3,
  KS:3,KY:3,LA:3,ME:3,MD:3,MA:3,MI:3,MN:3,MS:3,MO:5,MT:3,NE:3,NV:3,NH:5,NJ:3,
  NM:3,NY:3,NC:3,ND:3,OH:3,OK:3,OR:3,PA:3,RI:3,SC:3,SD:3,TN:3,TX:3,UT:3,VT:3,
  VA:3,WA:3,WV:3,WI:3,WY:3,DC:3,
};

export async function runEscheatmentScan(): Promise<void> {
  for (const [stateCode, dormancyYears] of Object.entries(STATE_DORMANCY_YEARS)) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - dormancyYears);

    const candidates = await prismaRead.card.findMany({
      where: {
        status: 'ACTIVE',
        recipientState: stateCode,
        lastUsedAt: { lt: cutoff },
        escheatmentRecords: { none: {} },
      },
      select: { id: true, programId: true, accountId: true, currency: true, lastUsedAt: true },
      take: 200,
    });

    for (const card of candidates) {
      try {
        const { getBalance } = await import('../../../api/src/modules/ledger/ledger.service');
        const { balance } = await getBalance(card.accountId);
        if (balance <= 0n) continue;

        await prisma.escheatmentRecord.create({
          data: {
            cardId: card.id, programId: card.programId,
            stateCode, holderState: stateCode, propertyType: 'GC01',
            amount: balance, currency: card.currency,
            dormantSince: card.lastUsedAt ?? cutoff, eligibleAt: new Date(), status: 'PENDING',
          },
        });
      } catch (err) {
        logger.error('Escheatment scan failed for card', { cardId: card.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  logger.info('Escheatment scan complete');
}
