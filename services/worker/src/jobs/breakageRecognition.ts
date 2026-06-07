import { prismaRead } from '../../../api/src/shared/db/prisma';
import { getBalance, postBreakageRecognition } from '../../../api/src/modules/ledger/ledger.service';
import { logger } from '../../../api/src/shared/utils/logger';

export async function runBreakageRecognition(): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const programs = await prismaRead.program.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, liabilityAccountId: true, breakageAccountId: true, currency: true },
  });

  for (const program of programs) {
    if (!program.liabilityAccountId || !program.breakageAccountId) continue;
    try {
      // Simplified: use 15% annual breakage rate
      const { balance: liability } = await getBalance(program.liabilityAccountId);
      const monthlyAmount = BigInt(Math.floor(Number(liability) * 0.15 / 12));
      if (monthlyAmount <= 0n) continue;

      await postBreakageRecognition({
        programId: program.id, liabilityAccountId: program.liabilityAccountId,
        breakageAccountId: program.breakageAccountId, amount: monthlyAmount,
        currency: program.currency, period,
      });
    } catch (err) {
      logger.error('Breakage recognition failed', { programId: program.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
