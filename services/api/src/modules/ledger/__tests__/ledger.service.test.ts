/**
 * Unit tests for ledger.service.ts
 *
 * Strategy:
 *  - Mock prisma, prismaRead, redis, kafka, and logger
 *  - Test invariant enforcement (balanced entries, positive amounts)
 *  - Test idempotency replay
 *  - Test balance computation from aggregates
 *  - Test postLoad/postAuth/postCapture/postVoid template correctness
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks — must use vi.hoisted so factory references survive hoisting ───────

const { mockPrisma, mockPrismaRead, mockRedis } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockPrisma: {
      journalEntry: { findUnique: fn(), create: fn() },
      journalLine: { createMany: fn() },
      balanceCheckpoint: { upsert: fn() },
      reconciliationLog: { create: fn() },
      program: { findUnique: fn(), update: fn() },
      account: { create: fn(), findMany: fn() },
      authorization: { aggregate: fn() },
      $transaction: fn(),
    },
    mockPrismaRead: {
      account: { findUnique: fn(), findMany: fn() },
      balanceCheckpoint: { findFirst: fn() },
      journalLine: { groupBy: fn(), findFirst: fn() },
      program: { findUnique: fn() },
      authorization: { aggregate: fn() },
    },
    mockRedis: {
      get: fn(),
      setex: fn(),
      del: fn(),
    },
  };
});

vi.mock('@/shared/db/prisma', () => ({
  prisma: mockPrisma,
  prismaRead: mockPrismaRead,
}));

vi.mock('@/shared/redis/client', () => ({
  redis: mockRedis,
}));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import {
  postEntry,
  getBalance,
  postLoad,
  postAuth,
  postCapture,
  postVoid,
  postReversal,
  postDormancyFee,
  bootstrapProgramAccounts,
  bootstrapCardAccounts,
} from '../ledger.service';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const PROGRAM_ID = 'prog_test_001';
const FLOAT_ACC = 'acc_float_001';
const CARD_ACC = 'acc_card_001';
const AUTH_HOLD_ACC = 'acc_hold_001';
const CURRENCY = 'USD';

function makeEntry(id = 'entry_001', postedAt = new Date()) {
  return { id, postedAt };
}

function setupTransactionMock(entryId = 'entry_001') {
  // $transaction receives a callback and we call it with a tx object
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
    const txMock = {
      journalEntry: {
        create: vi.fn().mockResolvedValue(makeEntry(entryId)),
      },
      journalLine: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    return cb(txMock as unknown as typeof mockPrisma);
  });
}

// ─── postEntry — validation ───────────────────────────────────────────────────

describe('postEntry — input validation', () => {
  beforeEach(() => {
    mockRedis.del.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue(null);
    setupTransactionMock();
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
  });

  it('throws INVALID_ENTRY when fewer than 2 lines', async () => {
    await expect(
      postEntry({
        type: 'LOAD',
        programId: PROGRAM_ID,
        description: 'test',
        lines: [{ accountId: FLOAT_ACC, direction: 'DEBIT', amount: 100n, currency: CURRENCY }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ENTRY' });
  });

  it('throws INVALID_AMOUNT when a line has zero amount', async () => {
    await expect(
      postEntry({
        type: 'LOAD',
        programId: PROGRAM_ID,
        description: 'test',
        lines: [
          { accountId: FLOAT_ACC, direction: 'DEBIT', amount: 0n, currency: CURRENCY },
          { accountId: CARD_ACC, direction: 'CREDIT', amount: 0n, currency: CURRENCY },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('throws INVALID_AMOUNT when a line has negative amount', async () => {
    await expect(
      postEntry({
        type: 'LOAD',
        programId: PROGRAM_ID,
        description: 'test',
        lines: [
          { accountId: FLOAT_ACC, direction: 'DEBIT', amount: -500n, currency: CURRENCY },
          { accountId: CARD_ACC, direction: 'CREDIT', amount: -500n, currency: CURRENCY },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('throws UNBALANCED_ENTRY when debits ≠ credits', async () => {
    await expect(
      postEntry({
        type: 'LOAD',
        programId: PROGRAM_ID,
        description: 'test',
        lines: [
          { accountId: FLOAT_ACC, direction: 'DEBIT', amount: 1000n, currency: CURRENCY },
          { accountId: CARD_ACC, direction: 'CREDIT', amount: 999n, currency: CURRENCY },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNBALANCED_ENTRY' });
  });

  it('posts a valid balanced entry and returns entryId + postedAt', async () => {
    const result = await postEntry({
      type: 'LOAD',
      programId: PROGRAM_ID,
      description: 'Initial load',
      lines: [
        { accountId: FLOAT_ACC, direction: 'DEBIT', amount: 5000n, currency: CURRENCY },
        { accountId: CARD_ACC, direction: 'CREDIT', amount: 5000n, currency: CURRENCY },
      ],
    });
    expect(result.entryId).toBe('entry_001');
    expect(result.postedAt).toBeInstanceOf(Date);
  });
});

// ─── postEntry — idempotency ──────────────────────────────────────────────────

describe('postEntry — idempotency', () => {
  it('replays an existing entry without writing a new one', async () => {
    const existing = makeEntry('entry_existing', new Date('2025-01-01'));
    mockPrisma.journalEntry.findUnique.mockResolvedValue(existing);

    const result = await postEntry({
      type: 'LOAD',
      programId: PROGRAM_ID,
      description: 'Idempotent load',
      idempotencyKey: 'idem_key_001',
      lines: [
        { accountId: FLOAT_ACC, direction: 'DEBIT', amount: 1000n, currency: CURRENCY },
        { accountId: CARD_ACC, direction: 'CREDIT', amount: 1000n, currency: CURRENCY },
      ],
    });

    expect(result.entryId).toBe('entry_existing');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── getBalance ───────────────────────────────────────────────────────────────

describe('getBalance', () => {
  const ACCOUNT_ID = 'acc_test_001';

  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
  });

  it('returns cached balance from Redis when available', async () => {
    const cached = { balance: '5000', currency: 'USD', computedAt: new Date().toISOString() };
    mockRedis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await getBalance(ACCOUNT_ID);

    expect(result.balance).toBe(5000n);
    expect(result.currency).toBe('USD');
    expect(mockPrismaRead.account.findUnique).not.toHaveBeenCalled();
  });

  it('computes balance from journal lines (no cache, no checkpoint)', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');

    mockPrismaRead.account.findUnique.mockResolvedValue({
      normalBalance: 'CREDIT',
      currency: 'USD',
    });
    mockPrismaRead.balanceCheckpoint.findFirst.mockResolvedValue(null);
    mockPrismaRead.journalLine.groupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amount: 10000n } },
      { direction: 'DEBIT', _sum: { amount: 2000n } },
    ]);

    const result = await getBalance(ACCOUNT_ID);

    // CREDIT-normal: balance = credits − debits = 10000 − 2000 = 8000
    expect(result.balance).toBe(8000n);
    expect(result.currency).toBe('USD');
  });

  it('applies checkpoint base balance to incremental lines', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');

    mockPrismaRead.account.findUnique.mockResolvedValue({
      normalBalance: 'CREDIT',
      currency: 'USD',
    });
    mockPrismaRead.balanceCheckpoint.findFirst.mockResolvedValue({
      balance: 5000n,
      checkpointAt: new Date('2025-01-01'),
      lastEntryId: 'entry_old',
    });
    mockPrismaRead.journalLine.groupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amount: 3000n } },
    ]);

    const result = await getBalance(ACCOUNT_ID);

    // base 5000 + (3000 credits − 0 debits) = 8000
    expect(result.balance).toBe(8000n);
  });

  it('computes DEBIT-normal account correctly (FLOAT)', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');

    mockPrismaRead.account.findUnique.mockResolvedValue({
      normalBalance: 'DEBIT',
      currency: 'USD',
    });
    mockPrismaRead.balanceCheckpoint.findFirst.mockResolvedValue(null);
    mockPrismaRead.journalLine.groupBy.mockResolvedValue([
      { direction: 'DEBIT', _sum: { amount: 10000n } },
      { direction: 'CREDIT', _sum: { amount: 3000n } },
    ]);

    const result = await getBalance(ACCOUNT_ID);

    // DEBIT-normal: balance = debits − credits = 10000 − 3000 = 7000
    expect(result.balance).toBe(7000n);
  });

  it('throws 404 when account not found', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrismaRead.account.findUnique.mockResolvedValue(null);

    await expect(getBalance('acc_missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
  });
});

// ─── Ledger entry template functions ─────────────────────────────────────────

describe('postLoad', () => {
  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    setupTransactionMock('load_001');
  });

  it('creates a balanced DEBIT(float) / CREDIT(card) entry', async () => {
    let capturedLines: unknown[] = [];
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      const txMock = {
        journalEntry: { create: vi.fn().mockResolvedValue(makeEntry('load_001')) },
        journalLine: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            capturedLines = data;
            return { count: data.length };
          }),
        },
      };
      return cb(txMock as unknown as typeof mockPrisma);
    });

    await postLoad({
      cardId: 'card_001',
      programId: PROGRAM_ID,
      floatAccountId: FLOAT_ACC,
      cardAccountId: CARD_ACC,
      amount: 2500n,
      currency: CURRENCY,
      description: 'Card issuance load',
    });

    expect(capturedLines).toHaveLength(2);
    const lines = capturedLines as Array<{ accountId: string; direction: string; amount: bigint }>;
    const debitLine = lines.find((l) => l.direction === 'DEBIT');
    const creditLine = lines.find((l) => l.direction === 'CREDIT');
    expect(debitLine?.accountId).toBe(FLOAT_ACC);
    expect(creditLine?.accountId).toBe(CARD_ACC);
    expect(debitLine?.amount).toBe(2500n);
    expect(creditLine?.amount).toBe(2500n);
  });
});

describe('postAuth', () => {
  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    setupTransactionMock('auth_001');
  });

  it('debits card account and credits auth-hold', async () => {
    let capturedLines: unknown[] = [];
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      const txMock = {
        journalEntry: { create: vi.fn().mockResolvedValue(makeEntry('auth_001')) },
        journalLine: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            capturedLines = data;
            return { count: data.length };
          }),
        },
      };
      return cb(txMock as unknown as typeof mockPrisma);
    });

    await postAuth({
      authorizationId: 'auth_abc',
      programId: PROGRAM_ID,
      cardAccountId: CARD_ACC,
      authHoldAccountId: AUTH_HOLD_ACC,
      amount: 1500n,
      currency: CURRENCY,
    });

    const lines = capturedLines as Array<{ accountId: string; direction: string }>;
    expect(lines.find((l) => l.direction === 'DEBIT')?.accountId).toBe(CARD_ACC);
    expect(lines.find((l) => l.direction === 'CREDIT')?.accountId).toBe(AUTH_HOLD_ACC);
  });
});

describe('postCapture', () => {
  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    setupTransactionMock('capture_001');
  });

  it('debits auth-hold and credits float', async () => {
    let capturedLines: unknown[] = [];
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      const txMock = {
        journalEntry: { create: vi.fn().mockResolvedValue(makeEntry('capture_001')) },
        journalLine: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            capturedLines = data;
            return { count: data.length };
          }),
        },
      };
      return cb(txMock as unknown as typeof mockPrisma);
    });

    await postCapture({
      authorizationId: 'auth_abc',
      programId: PROGRAM_ID,
      authHoldAccountId: AUTH_HOLD_ACC,
      floatAccountId: FLOAT_ACC,
      amount: 1500n,
      currency: CURRENCY,
    });

    const lines = capturedLines as Array<{ accountId: string; direction: string }>;
    expect(lines.find((l) => l.direction === 'DEBIT')?.accountId).toBe(AUTH_HOLD_ACC);
    expect(lines.find((l) => l.direction === 'CREDIT')?.accountId).toBe(FLOAT_ACC);
  });
});

describe('postVoid', () => {
  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    setupTransactionMock('void_001');
  });

  it('debits auth-hold and credits card (releases hold)', async () => {
    let capturedLines: unknown[] = [];
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      const txMock = {
        journalEntry: { create: vi.fn().mockResolvedValue(makeEntry('void_001')) },
        journalLine: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            capturedLines = data;
            return { count: data.length };
          }),
        },
      };
      return cb(txMock as unknown as typeof mockPrisma);
    });

    await postVoid({
      authorizationId: 'auth_abc',
      programId: PROGRAM_ID,
      authHoldAccountId: AUTH_HOLD_ACC,
      cardAccountId: CARD_ACC,
      amount: 1500n,
      currency: CURRENCY,
    });

    const lines = capturedLines as Array<{ accountId: string; direction: string }>;
    expect(lines.find((l) => l.direction === 'DEBIT')?.accountId).toBe(AUTH_HOLD_ACC);
    expect(lines.find((l) => l.direction === 'CREDIT')?.accountId).toBe(CARD_ACC);
  });
});

describe('postReversal', () => {
  beforeEach(() => {
    mockPrisma.journalEntry.findUnique.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    setupTransactionMock('reversal_001');
  });

  it('debits float and credits card (refund)', async () => {
    let capturedLines: unknown[] = [];
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      const txMock = {
        journalEntry: { create: vi.fn().mockResolvedValue(makeEntry('reversal_001')) },
        journalLine: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            capturedLines = data;
            return { count: data.length };
          }),
        },
      };
      return cb(txMock as unknown as typeof mockPrisma);
    });

    await postReversal({
      authorizationId: 'auth_abc',
      programId: PROGRAM_ID,
      floatAccountId: FLOAT_ACC,
      cardAccountId: CARD_ACC,
      amount: 750n,
      currency: CURRENCY,
    });

    const lines = capturedLines as Array<{ accountId: string; direction: string }>;
    expect(lines.find((l) => l.direction === 'DEBIT')?.accountId).toBe(FLOAT_ACC);
    expect(lines.find((l) => l.direction === 'CREDIT')?.accountId).toBe(CARD_ACC);
  });
});

// ─── bootstrapProgramAccounts ─────────────────────────────────────────────────

describe('bootstrapProgramAccounts', () => {
  it('creates 5 accounts and returns their IDs', async () => {
    const txMock = {
      account: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'acc_float' })
          .mockResolvedValueOnce({ id: 'acc_liability' })
          .mockResolvedValueOnce({ id: 'acc_breakage' })
          .mockResolvedValueOnce({ id: 'acc_fee' })
          .mockResolvedValueOnce({ id: 'acc_escrow' }),
      },
    };

    const result = await bootstrapProgramAccounts(
      PROGRAM_ID,
      'USD',
      txMock as unknown as Parameters<typeof bootstrapProgramAccounts>[2],
    );

    expect(result.floatAccountId).toBe('acc_float');
    expect(result.liabilityAccountId).toBe('acc_liability');
    expect(result.breakageAccountId).toBe('acc_breakage');
    expect(result.feeAccountId).toBe('acc_fee');
    expect(result.escrowAccountId).toBe('acc_escrow');
    expect(txMock.account.create).toHaveBeenCalledTimes(5);
  });
});

// ─── bootstrapCardAccounts ────────────────────────────────────────────────────

describe('bootstrapCardAccounts', () => {
  it('creates card account and auth-hold account', async () => {
    const txMock = {
      account: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'acc_card_new' })
          .mockResolvedValueOnce({ id: 'acc_hold_new' }),
      },
    };

    const result = await bootstrapCardAccounts(
      PROGRAM_ID,
      'USD',
      'Card •••• 1234',
      txMock as unknown as Parameters<typeof bootstrapCardAccounts>[3],
    );

    expect(result.cardAccountId).toBe('acc_card_new');
    expect(result.authHoldAccountId).toBe('acc_hold_new');
    expect(txMock.account.create).toHaveBeenCalledTimes(2);
  });
});
