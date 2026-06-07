import type { Prisma } from '@prisma/client';

export type JournalEntryType =
  | 'LOAD'
  | 'AUTH'
  | 'CAPTURE'
  | 'REVERSAL'
  | 'VOID'
  | 'REFUND'
  | 'FEE'
  | 'ADJUSTMENT'
  | 'ESCHEAT'
  | 'BREAKAGE_RECOGNITION'
  | 'SETTLEMENT'
  | 'RELOAD'
  | 'DISPUTE_CREDIT'
  | 'DISPUTE_REVERSAL';

export type AccountType =
  | 'CARD'
  | 'FLOAT'
  | 'LIABILITY_RESERVE'
  | 'BREAKAGE'
  | 'FEE_INCOME'
  | 'ESCROW'
  | 'SETTLEMENT_SUSPENSE'
  | 'AUTH_HOLD';

export type NormalBalance = 'DEBIT' | 'CREDIT';
export type Direction = 'DEBIT' | 'CREDIT';

export interface EntryLine {
  accountId: string;
  direction: Direction;
  /** Must be a positive bigint in minor currency units */
  amount: bigint;
  currency: string;
}

export interface PostEntryInput {
  type: JournalEntryType;
  programId: string;
  description: string;
  lines: EntryLine[];
  idempotencyKey?: string;
  authorizationId?: string;
  orderId?: string;
  initiatedBy?: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
  /** Pass when calling inside an existing Prisma transaction */
  tx?: Prisma.TransactionClient;
}

export interface PostEntryResult {
  entryId: string;
  postedAt: Date;
}

export interface BalanceResult {
  balance: bigint;
  currency: string;
  accountId: string;
  computedAt: Date;
}

export interface ReconciliationResult {
  programId: string;
  asOf: Date;
  floatBalance: bigint;
  totalCardBalances: bigint;
  pendingAuthorizations: bigint;
  expectedFloat: bigint;
  variance: bigint;
  isBalanced: boolean;
  status: 'BALANCED' | 'VARIANCE' | 'CRITICAL';
}
