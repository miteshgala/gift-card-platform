/**
 * Ledger Service — the single entry point for ALL financial operations.
 *
 * No other module writes directly to journal_lines. They call this service.
 *
 * Invariants enforced here (and again by DB trigger):
 *   1. SUM(debits) === SUM(credits) within every entry
 *   2. All amounts are positive bigints
 *   3. Every line references a valid account in the same program (or system account)
 *   4. Posted entries are never mutated — corrections are new reversal entries
 */

import { prisma, prismaRead } from '../../shared/db/prisma';
import { redis } from '../../shared/redis/client';
import { publish, TOPICS } from '../../shared/kafka/client';
import { logger } from '../../shared/utils/logger';
import { AppError } from '../../shared/errors/AppError';
import { env } from '../../shared/utils/env';
import type {
  PostEntryInput,
  PostEntryResult,
  BalanceResult,
  ReconciliationResult,
  EntryLine,
} from './ledger.types';
import type { Prisma } from '@prisma/client';

// Redis TTL for balance cache (5 seconds — intentionally short, used only for read-heavy paths)
const BALANCE_CACHE_TTL = 5;
const BALANCE_CACHE_PREFIX = 'bal:';

// ─── Core: postEntry ──────────────────────────────────────────────────────────

export async function postEntry(input: PostEntryInput): Promise<PostEntryResult> {
  // 1. Fast-fail validation in application layer (DB trigger is the backstop)
  validateLines(input.lines);

  // 2. Check idempotency key
  if (input.idempotencyKey) {
    const existing = await (input.tx ?? prisma).journalEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, postedAt: true },
    });
    if (existing) {
      logger.debug('Ledger idempotency replay', { idempotencyKey: input.idempotencyKey });
      return { entryId: existing.id, postedAt: existing.postedAt };
    }
  }

  // 3. Write entry + all lines in one transaction
  const writeInTx = async (tx: Prisma.TransactionClient) => {
    const entry = await tx.journalEntry.create({
      data: {
        entryType: input.type,
        status: 'POSTED',
        idempotencyKey: input.idempotencyKey ?? null,
        authorizationId: input.authorizationId ?? null,
        orderId: input.orderId ?? null,
        programId: input.programId,
        initiatedBy: input.initiatedBy ?? null,
        externalRef: input.externalRef ?? null,
        description: input.description,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    await tx.journalLine.createMany({
      data: input.lines.map((line, idx) => ({
        entryId: entry.id,
        accountId: line.accountId,
        direction: line.direction,
        amount: line.amount,
        currency: line.currency,
        sequence: idx,
      })),
    });

    return entry;
  };

  const result = input.tx
    ? await writeInTx(input.tx)
    : await prisma.$transaction(writeInTx);

  // 4. Invalidate balance cache for affected accounts
  const accountIds = input.lines.map((l) => l.accountId);
  const cacheKeys = accountIds.map((id) => `${BALANCE_CACHE_PREFIX}${id}`);
  if (cacheKeys.length > 0) {
    await redis.del(...cacheKeys).catch(() => {/* non-fatal */});
  }

  // 5. Publish event (non-fatal if Kafka is down)
  await publish({
    topic: TOPICS.LEDGER_ENTRIES,
    key: input.programId,
    value: {
      entryId: result.id,
      entryType: input.type,
      programId: input.programId,
      description: input.description,
      postedAt: result.postedAt.toISOString(),
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        direction: l.direction,
        amount: l.amount.toString(),
        currency: l.currency,
      })),
    },
  });

  logger.info('Journal entry posted', {
    entryId: result.id,
    entryType: input.type,
    programId: input.programId,
    lineCount: input.lines.length,
  });

  return { entryId: result.id, postedAt: result.postedAt };
}

// ─── Core: getBalance ─────────────────────────────────────────────────────────

export async function getBalance(accountId: string): Promise<BalanceResult> {
  // 1. Check Redis cache
  const cacheKey = `${BALANCE_CACHE_PREFIX}${accountId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    const parsed = JSON.parse(cached) as { balance: string; currency: string; computedAt: string };
    return {
      accountId,
      balance: BigInt(parsed.balance),
      currency: parsed.currency,
      computedAt: new Date(parsed.computedAt),
    };
  }

  // 2. Load account for normal_balance direction
  const account = await prismaRead.account.findUnique({
    where: { id: accountId },
    select: { normalBalance: true, currency: true },
  });
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`);

  // 3. Find latest checkpoint
  const checkpoint = await prismaRead.balanceCheckpoint.findFirst({
    where: { accountId },
    orderBy: { checkpointAt: 'desc' },
    select: { balance: true, checkpointAt: true, lastEntryId: true },
  });

  // 4. Sum lines since checkpoint
  const since = checkpoint?.checkpointAt ?? new Date(0);

  const aggregates = await prismaRead.journalLine.groupBy({
    by: ['direction'],
    where: {
      accountId,
      entry: {
        status: 'POSTED',
        postedAt: { gt: since },
      },
    },
    _sum: { amount: true },
  });

  const creditSum = aggregates.find((r: typeof aggregates[number]) => r.direction === 'CREDIT')?._sum.amount ?? 0n;
  const debitSum = aggregates.find((r: typeof aggregates[number]) => r.direction === 'DEBIT')?._sum.amount ?? 0n;

  // 5. Apply sign based on account's normal balance
  //    CREDIT-normal (CARD, LIABILITY, BREAKAGE, FEE, ESCROW): CR increases, DR decreases
  //    DEBIT-normal  (FLOAT, SETTLEMENT_SUSPENSE, AUTH_HOLD):  DR increases, CR decreases
  const incremental =
    account.normalBalance === 'CREDIT' ? creditSum - debitSum : debitSum - creditSum;

  const base = checkpoint?.balance ?? 0n;
  const balance = base + incremental;
  const computedAt = new Date();

  // 6. Cache result
  await redis
    .setex(
      cacheKey,
      BALANCE_CACHE_TTL,
      JSON.stringify({ balance: balance.toString(), currency: account.currency, computedAt: computedAt.toISOString() }),
    )
    .catch(() => {/* non-fatal */});

  return { accountId, balance, currency: account.currency, computedAt };
}

// ─── Checkpoint writer (called by scheduled job every hour) ───────────────────

export async function writeCheckpoint(accountId: string): Promise<void> {
  const { balance, currency } = await getBalance(accountId);

  // Find the most recent posted entry for this account
  const lastLine = await prismaRead.journalLine.findFirst({
    where: { accountId, entry: { status: 'POSTED' } },
    orderBy: { createdAt: 'desc' },
    select: { entryId: true },
  });

  if (!lastLine) return; // No entries yet — nothing to checkpoint

  await prisma.balanceCheckpoint.upsert({
    where: {
      accountId_checkpointAt: {
        accountId,
        checkpointAt: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000), // floor to current hour
      },
    },
    create: {
      accountId,
      balance,
      currency,
      checkpointAt: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000),
      lastEntryId: lastLine.entryId,
    },
    update: {
      balance,
      lastEntryId: lastLine.entryId,
    },
  });
}

// ─── Entry template functions ─────────────────────────────────────────────────

/**
 * LOAD — card is funded (e.g., issuance or reload)
 * DR FLOAT, CR CARD
 */
export async function postLoad(params: {
  cardId: string;
  programId: string;
  floatAccountId: string;
  cardAccountId: string;
  amount: bigint;
  currency: string;
  description: string;
  orderId?: string;
  initiatedBy?: string;
  idempotencyKey?: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'LOAD',
    programId: params.programId,
    description: params.description,
    orderId: params.orderId,
    initiatedBy: params.initiatedBy,
    idempotencyKey: params.idempotencyKey,
    tx: params.tx,
    lines: [
      { accountId: params.floatAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * AUTH — create a hold on the card balance
 * DR CARD, CR AUTH_HOLD
 *
 * Note: AUTH_HOLD is a per-card transit account that holds funds
 * between authorization and capture/void.
 */
export async function postAuth(params: {
  authorizationId?: string;  // optional: links entry to Authorization record
  programId: string;
  cardAccountId: string;
  authHoldAccountId: string;
  amount: bigint;
  currency: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'AUTH',
    programId: params.programId,
    description: 'Authorization hold',
    authorizationId: params.authorizationId,
    tx: params.tx,
    lines: [
      { accountId: params.cardAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.authHoldAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * CAPTURE — merchant settles; move from hold to float (program pays merchant)
 * DR AUTH_HOLD, CR FLOAT
 */
export async function postCapture(params: {
  authorizationId?: string;
  programId: string;
  authHoldAccountId: string;
  floatAccountId: string;
  amount: bigint;
  currency: string;
  externalRef?: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'CAPTURE',
    programId: params.programId,
    description: 'Capture',
    authorizationId: params.authorizationId,
    externalRef: params.externalRef,
    tx: params.tx,
    lines: [
      { accountId: params.authHoldAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.floatAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * VOID — auth cancelled before capture; release the hold back to card
 * DR AUTH_HOLD, CR CARD
 */
export async function postVoid(params: {
  authorizationId?: string;
  programId: string;
  authHoldAccountId: string;
  cardAccountId: string;
  amount: bigint;
  currency: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'VOID',
    programId: params.programId,
    description: 'Authorization voided',
    authorizationId: params.authorizationId,
    tx: params.tx,
    lines: [
      { accountId: params.authHoldAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * REVERSAL — refund after a capture; money flows back to card
 * DR FLOAT, CR CARD
 */
export async function postReversal(params: {
  authorizationId?: string;
  programId: string;
  floatAccountId: string;
  cardAccountId: string;
  amount: bigint;
  currency: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'REVERSAL',
    programId: params.programId,
    description: 'Reversal / refund',
    authorizationId: params.authorizationId,
    tx: params.tx,
    lines: [
      { accountId: params.floatAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * FEE — dormancy or service fee deducted from card
 * DR CARD, CR FEE_INCOME
 * CARD Act constraint: caller must verify fee <= card balance before calling.
 */
export async function postDormancyFee(params: {
  cardId: string;
  programId: string;
  cardAccountId: string;
  feeAccountId: string;
  amount: bigint;
  currency: string;
  idempotencyKey?: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'FEE',
    programId: params.programId,
    description: 'Dormancy fee',
    idempotencyKey: params.idempotencyKey,
    tx: params.tx,
    metadata: { cardId: params.cardId },
    lines: [
      { accountId: params.cardAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.feeAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * BREAKAGE_RECOGNITION — periodic accounting entry (ASC 606)
 * DR LIABILITY_RESERVE, CR BREAKAGE
 */
export async function postBreakageRecognition(params: {
  programId: string;
  liabilityAccountId: string;
  breakageAccountId: string;
  amount: bigint;
  currency: string;
  period: string; // e.g. '2025-01'
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'BREAKAGE_RECOGNITION',
    programId: params.programId,
    description: `Breakage recognition — ${params.period}`,
    idempotencyKey: `breakage:${params.programId}:${params.period}`,
    metadata: { period: params.period },
    lines: [
      { accountId: params.liabilityAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.breakageAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * ESCHEAT — remaining card balance moved to escrow pending state remittance
 * DR CARD, CR ESCROW
 */
export async function postEscheatment(params: {
  cardId: string;
  programId: string;
  cardAccountId: string;
  escrowAccountId: string;
  amount: bigint;
  currency: string;
  stateCode: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'ESCHEAT',
    programId: params.programId,
    description: `Escheatment — ${params.stateCode}`,
    tx: params.tx,
    metadata: { cardId: params.cardId, stateCode: params.stateCode },
    lines: [
      { accountId: params.cardAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.escrowAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * RELOAD — cardholder top-up via Stripe payment
 * DR FLOAT, CR CARD
 */
export async function postReload(params: {
  cardId: string;
  programId: string;
  floatAccountId: string;
  cardAccountId: string;
  amount: bigint;
  currency: string;
  stripePaymentIntentId: string;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'RELOAD',
    programId: params.programId,
    description: 'Cardholder reload',
    idempotencyKey: `reload:${params.stripePaymentIntentId}`,
    externalRef: params.stripePaymentIntentId,
    metadata: { cardId: params.cardId },
    lines: [
      { accountId: params.floatAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * DISPUTE_CREDIT — provisional credit issued while dispute is under review
 * DR FLOAT, CR CARD
 */
export async function postDisputeCredit(params: {
  disputeId: string;
  programId: string;
  floatAccountId: string;
  cardAccountId: string;
  amount: bigint;
  currency: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'DISPUTE_CREDIT',
    programId: params.programId,
    description: 'Provisional dispute credit',
    idempotencyKey: `dispute_credit:${params.disputeId}`,
    tx: params.tx,
    metadata: { disputeId: params.disputeId },
    lines: [
      { accountId: params.floatAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

/**
 * DISPUTE_REVERSAL — provisional credit reversed when dispute is lost
 * DR CARD, CR FLOAT
 */
export async function postDisputeReversal(params: {
  disputeId: string;
  programId: string;
  cardAccountId: string;
  floatAccountId: string;
  amount: bigint;
  currency: string;
  tx?: Prisma.TransactionClient;
}): Promise<PostEntryResult> {
  return postEntry({
    type: 'DISPUTE_REVERSAL',
    programId: params.programId,
    description: 'Dispute provisional credit reversed',
    idempotencyKey: `dispute_reversal:${params.disputeId}`,
    tx: params.tx,
    metadata: { disputeId: params.disputeId },
    lines: [
      { accountId: params.cardAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
      { accountId: params.floatAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
    ],
  });
}

// ─── Manual adjustment (SUPER_ADMIN only — requires written reason) ────────────

export async function postAdjustment(params: {
  cardId: string;
  programId: string;
  cardAccountId: string;
  floatAccountId: string;
  amount: bigint;
  currency: string;
  direction: 'CREDIT' | 'DEBIT'; // relative to the card account
  reason: string;
  initiatedBy: string;
}): Promise<PostEntryResult> {
  const lines: EntryLine[] =
    params.direction === 'CREDIT'
      ? [
          { accountId: params.floatAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
          { accountId: params.cardAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
        ]
      : [
          { accountId: params.cardAccountId, direction: 'DEBIT', amount: params.amount, currency: params.currency },
          { accountId: params.floatAccountId, direction: 'CREDIT', amount: params.amount, currency: params.currency },
        ];

  return postEntry({
    type: 'ADJUSTMENT',
    programId: params.programId,
    description: `Manual adjustment: ${params.reason}`,
    initiatedBy: params.initiatedBy,
    metadata: { cardId: params.cardId, reason: params.reason, direction: params.direction },
    lines,
  });
}

// ─── Float reconciliation ─────────────────────────────────────────────────────

export async function reconcileProgram(programId: string): Promise<ReconciliationResult> {
  const program = await prismaRead.program.findUnique({
    where: { id: programId },
    select: { floatAccountId: true, currency: true },
  });
  if (!program?.floatAccountId) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');

  // Float balance
  const { balance: floatBalance } = await getBalance(program.floatAccountId);

  // Sum all ACTIVE card account balances
  const cardAccounts = await prismaRead.account.findMany({
    where: { programId, accountType: 'CARD', status: 'ACTIVE' },
    select: { id: true },
  });

  let totalCardBalances = 0n;
  for (const acc of cardAccounts) {
    const { balance } = await getBalance(acc.id);
    if (balance > 0n) totalCardBalances += balance;
  }

  // Outstanding AUTH holds (pending authorizations not yet captured/voided)
  const pendingAggr = await prismaRead.authorization.aggregate({
    where: {
      programId,
      status: 'PENDING',
    },
    _sum: { authorizedAmount: true },
  });
  const pendingAuthorizations = pendingAggr._sum.authorizedAmount ?? 0n;

  const expectedFloat = totalCardBalances + pendingAuthorizations;
  const variance = floatBalance - expectedFloat;
  const threshold = env.RECON_VARIANCE_THRESHOLD_CENTS;

  const status =
    variance === 0n ? 'BALANCED'
    : variance < 0n || variance > threshold ? 'CRITICAL'
    : 'VARIANCE';

  const result: ReconciliationResult = {
    programId,
    asOf: new Date(),
    floatBalance,
    totalCardBalances,
    pendingAuthorizations,
    expectedFloat,
    variance,
    isBalanced: status === 'BALANCED',
    status,
  };

  // Persist the reconciliation log
  await prisma.reconciliationLog.create({
    data: {
      programId,
      asOf: result.asOf,
      floatBalance: result.floatBalance,
      totalCardBalances: result.totalCardBalances,
      pendingAuths: result.pendingAuthorizations,
      variance: result.variance,
      status: result.status,
    },
  });

  if (status === 'CRITICAL') {
    logger.error('CRITICAL: Float reconciliation variance detected', {
      programId,
      variance: variance.toString(),
      floatBalance: floatBalance.toString(),
      totalCardBalances: totalCardBalances.toString(),
    });
    // Suspend program issuance
    await prisma.program.update({
      where: { id: programId },
      data: { status: 'SUSPENDED_RECON' },
    });
  }

  return result;
}

// ─── Account bootstrap (called when a program is created) ────────────────────

export async function bootstrapProgramAccounts(
  programId: string,
  currency: string,
  tx: Prisma.TransactionClient,
): Promise<{
  floatAccountId: string;
  liabilityAccountId: string;
  breakageAccountId: string;
  feeAccountId: string;
  escrowAccountId: string;
}> {
  const create = (accountType: string, normalBalance: string, label: string) =>
    tx.account.create({
      data: { accountType, normalBalance, currency, programId, label, status: 'ACTIVE' },
      select: { id: true },
    });

  const [float, liability, breakage, fee, escrow] = await Promise.all([
    create('FLOAT', 'DEBIT', 'Program Float'),
    create('LIABILITY_RESERVE', 'CREDIT', 'Liability Reserve'),
    create('BREAKAGE', 'CREDIT', 'Breakage Income'),
    create('FEE_INCOME', 'CREDIT', 'Fee Income'),
    create('ESCROW', 'CREDIT', 'Escheatment Escrow'),
  ]);

  return {
    floatAccountId: float.id,
    liabilityAccountId: liability.id,
    breakageAccountId: breakage.id,
    feeAccountId: fee.id,
    escrowAccountId: escrow.id,
  };
}

/**
 * Create a CARD account + AUTH_HOLD transit account for a new card.
 */
export async function bootstrapCardAccounts(
  programId: string,
  currency: string,
  cardLabel: string,
  tx: Prisma.TransactionClient,
): Promise<{ cardAccountId: string; authHoldAccountId: string }> {
  const [cardAccount, authHoldAccount] = await Promise.all([
    tx.account.create({
      data: { accountType: 'CARD', normalBalance: 'CREDIT', currency, programId, label: cardLabel, status: 'ACTIVE' },
      select: { id: true },
    }),
    tx.account.create({
      data: { accountType: 'AUTH_HOLD', normalBalance: 'CREDIT', currency, programId, label: `${cardLabel} — Auth Hold`, status: 'ACTIVE' },
      select: { id: true },
    }),
  ]);

  return { cardAccountId: cardAccount.id, authHoldAccountId: authHoldAccount.id };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function validateLines(lines: EntryLine[]): void {
  if (lines.length < 2) {
    throw new AppError(400, 'INVALID_ENTRY', 'A journal entry requires at least 2 lines');
  }

  let debitSum = 0n;
  let creditSum = 0n;

  for (const line of lines) {
    if (line.amount <= 0n) {
      throw new AppError(400, 'INVALID_AMOUNT', 'All journal line amounts must be positive');
    }
    if (line.direction === 'DEBIT') debitSum += line.amount;
    else creditSum += line.amount;
  }

  if (debitSum !== creditSum) {
    throw new AppError(
      400,
      'UNBALANCED_ENTRY',
      `Journal entry is unbalanced: debits=${debitSum} credits=${creditSum}`,
    );
  }
}
