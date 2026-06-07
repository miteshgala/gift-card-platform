/**
 * Authorization Service
 *
 * The hottest path in the system. Target: p99 < 150ms end-to-end.
 *
 * Processing order:
 *   1.  Idempotency check (Redis, ~1ms)
 *   2.  Load card (read replica, indexed)
 *   3.  Layer 1: Hard blocks (in-memory, ~0ms)
 *   4.  PIN verification (bcrypt, ~100ms — do early to fail fast on bad PIN)
 *   5.  Fraud engine call (HTTP, 80ms deadline)
 *   6.  Balance check (checkpoint + incremental)
 *   7.  Advisory lock acquisition
 *   8.  Re-check balance inside transaction
 *   9.  Write auth + ledger entry
 *  10.  Release lock
 *  11.  Publish event
 *  12.  Return response
 */

import crypto from 'crypto';
import { prisma, prismaRead } from '../../shared/db/prisma';
import { redis } from '../../shared/redis/client';
import { Errors } from '../../shared/errors/AppError';
import { getBalance, postAuth, postCapture, postVoid, postReversal } from '../ledger/ledger.service';
import { publish, TOPICS } from '../../shared/kafka/client';
import { logger } from '../../shared/utils/logger';
import { authorizationsTotal, authLatency, fraudEngineLatency } from '../../shared/utils/metrics';
import { verifyPin } from './cards.service';
import { env } from '../../shared/utils/env';
import type { Prisma } from '@prisma/client';

const IDEMPOTENCY_TTL = 86_400; // 24 hours in seconds

export interface AuthorizeInput {
  idempotencyKey: string;
  vaultToken: string;
  pin?: string;
  requestedAmountCents: bigint;
  currency: string;
  merchantName?: string;
  merchantMcc?: string;
  merchantCountry?: string;
  posEntryMode?: string;
  retrievalRef?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthorizeResult {
  authorizationId: string;
  authCode: string | null;
  approved: boolean;
  approvedAmountCents: bigint;
  declineCode?: string;
  fraudScore?: number;
}

// ─── Authorize ────────────────────────────────────────────────────────────────

export async function authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
  const timer = authLatency.startTimer();

  // 1. Idempotency (Redis)
  const idempotencyRedisKey = `auth:idem:${input.idempotencyKey}`;
  const cached = await redis.get(idempotencyRedisKey);
  if (cached) {
    timer({ decision: 'replay' });
    return JSON.parse(cached) as AuthorizeResult;
  }

  // 2. Load card by vault token
  const card = await prismaRead.card.findFirst({
    where: { vaultToken: input.vaultToken },
    include: {
      program: { select: { id: true, status: true, floatAccountId: true, currency: true } },
      account: { select: { id: true } },
    },
  });

  // ── Layer 1: Hard Blocks ─────────────────────────────────────────────────────

  if (!card) {
    const result: AuthorizeResult = { authorizationId: '', authCode: null, approved: false, approvedAmountCents: 0n, declineCode: 'CARD_NOT_FOUND' };
    timer({ decision: 'decline' });
    authorizationsTotal.inc({ program_id: 'unknown', decision: 'decline', decline_code: 'CARD_NOT_FOUND' });
    return result;
  }

  const programId = card.programId;

  if (card.status === 'SUSPENDED') {
    return decline(card.id, programId, 'CARD_SUSPENDED', input, timer);
  }
  if (card.status === 'EXPIRED' || card.expiresAt < new Date()) {
    return decline(card.id, programId, 'CARD_EXPIRED', input, timer);
  }
  if (['CANCELLED', 'ESHEATED'].includes(card.status)) {
    return decline(card.id, programId, 'CARD_CANCELLED', input, timer);
  }
  if (card.status === 'PENDING_ACTIVATION') {
    return decline(card.id, programId, 'CARD_NOT_ACTIVE', input, timer);
  }
  if (card.program.status !== 'ACTIVE') {
    return decline(card.id, programId, 'PROGRAM_SUSPENDED', input, timer);
  }
  if (input.currency !== card.currency) {
    return decline(card.id, programId, 'CURRENCY_MISMATCH', input, timer);
  }

  // 4. PIN verification (if provided)
  if (input.pin) {
    try {
      await verifyPin(card.id, input.pin);
    } catch {
      return decline(card.id, programId, 'INVALID_PIN', input, timer);
    }
  }

  // 5. Fraud engine call
  const fraudResult = await callFraudEngine({
    authorizationId: input.idempotencyKey,
    vaultToken: input.vaultToken,
    amount: input.requestedAmountCents,
    currency: input.currency,
    merchantMcc: input.merchantMcc,
    merchantCountry: input.merchantCountry,
    posEntryMode: input.posEntryMode,
    ipAddress: input.ipAddress,
    deviceFingerprint: input.deviceFingerprint,
    programId,
  });

  if (fraudResult.decision === 'DECLINE') {
    return decline(card.id, programId, `FRAUD_DECLINE:${fraudResult.declineCode ?? 'SCORE'}`, input, timer, fraudResult.riskScore);
  }

  // 6. Balance check (fast path via cache)
  const { balance: availableBalance } = await getBalance(card.accountId);

  if (availableBalance < input.requestedAmountCents) {
    return decline(card.id, programId, 'INSUFFICIENT_FUNDS', input, timer, fraudResult.riskScore);
  }

  // 7. Advisory lock — serializes concurrent auths on the same card
  // PostgreSQL pg_advisory_xact_lock uses a 64-bit integer key derived from card ID
  const lockKey = hashCardIdToLockKey(card.id);

  const authResult = await prisma.$transaction(async (tx) => {
    // Acquire advisory lock (released automatically when transaction completes)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

    // 8. Re-check balance inside lock (prevents double-spend under concurrent load)
    const { balance: lockedBalance } = await getBalance(card.accountId);
    if (lockedBalance < input.requestedAmountCents) {
      return null; // Signal insufficient funds after lock
    }

    // Get auth hold account
    const authHoldAccount = await tx.account.findFirst({
      where: { cardId: card.id, accountType: 'AUTH_HOLD' },
      select: { id: true },
    });
    if (!authHoldAccount) throw new Error(`AUTH_HOLD account missing for card ${card.id}`);

    // 9. Write authorization record
    const authCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const authorization = await tx.authorization.create({
      data: {
        cardId: card.id,
        accountId: card.accountId,
        programId,
        status: 'PENDING',
        requestedAmount: input.requestedAmountCents,
        authorizedAmount: input.requestedAmountCents,
        currency: input.currency,
        merchantName: input.merchantName ?? null,
        merchantMcc: input.merchantMcc ?? null,
        merchantCountry: input.merchantCountry ?? null,
        posEntryMode: input.posEntryMode ?? null,
        retrievalRef: input.retrievalRef ?? null,
        authCode,
        fraudScore: fraudResult.riskScore,
        fraudDecision: fraudResult.decision,
        idempotencyKey: input.idempotencyKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true, authCode: true },
    });

    // Post AUTH ledger entry
    await postAuth({
      authorizationId: authorization.id,
      programId,
      cardAccountId: card.accountId,
      authHoldAccountId: authHoldAccount.id,
      amount: input.requestedAmountCents,
      currency: input.currency,
      tx,
    });

    // Update card last_used_at
    await tx.card.update({ where: { id: card.id }, data: { lastUsedAt: new Date() } });

    return authorization;
  });

  // Post-lock: check if we got a null (insufficient funds after lock)
  if (!authResult) {
    return decline(card.id, programId, 'INSUFFICIENT_FUNDS', input, timer, fraudResult.riskScore);
  }

  // 11. Publish event
  await publish({
    topic: TOPICS.AUTHORIZATION_EVENTS,
    key: programId,
    value: {
      event: 'card.authorized',
      authorizationId: authResult.id,
      cardId: card.id,
      programId,
      amount: input.requestedAmountCents.toString(),
      currency: input.currency,
      merchantName: input.merchantName,
      fraudScore: fraudResult.riskScore,
      authorizedAt: new Date().toISOString(),
    },
  });

  const result: AuthorizeResult = {
    authorizationId: authResult.id,
    authCode: authResult.authCode,
    approved: true,
    approvedAmountCents: input.requestedAmountCents,
    fraudScore: fraudResult.riskScore,
  };

  // Cache idempotency result
  await redis.setex(idempotencyRedisKey, IDEMPOTENCY_TTL, JSON.stringify({
    ...result,
    approvedAmountCents: result.approvedAmountCents.toString(),
  })).catch(() => {/* non-fatal */});

  timer({ decision: 'approve' });
  authorizationsTotal.inc({ program_id: programId, decision: 'approve', decline_code: '' });

  logger.info('Authorization approved', {
    authorizationId: authResult.id, cardId: card.id, programId,
    amount: input.requestedAmountCents.toString(), fraudScore: fraudResult.riskScore,
  });

  return result;
}

// ─── Capture ──────────────────────────────────────────────────────────────────

export async function capture(authorizationId: string, captureAmountCents: bigint, externalRef?: string): Promise<void> {
  const auth = await prisma.authorization.findUnique({
    where: { id: authorizationId },
    include: { card: { include: { program: { select: { floatAccountId: true } } } } },
  });

  if (!auth) throw Errors.authorizationNotFound();
  if (auth.status !== 'PENDING' && auth.status !== 'PARTIALLY_CAPTURED') throw Errors.authorizationNotFound();
  if (auth.expiresAt < new Date()) throw Errors.authorizationExpired();

  const remaining = auth.authorizedAmount - auth.capturedAmount;
  if (captureAmountCents > remaining) throw Errors.captureExceedsAuth(auth.authorizedAmount, remaining);

  const authHoldAccount = await prismaRead.account.findFirst({
    where: { cardId: auth.cardId, accountType: 'AUTH_HOLD' },
    select: { id: true },
  });
  if (!authHoldAccount) throw new Error('AUTH_HOLD account not found');

  await prisma.$transaction(async (tx) => {
    await postCapture({
      authorizationId,
      programId: auth.programId,
      authHoldAccountId: authHoldAccount.id,
      floatAccountId: auth.card.program.floatAccountId!,
      amount: captureAmountCents,
      currency: auth.currency,
      externalRef,
      tx,
    });

    const newCaptured = auth.capturedAmount + captureAmountCents;
    const newStatus = newCaptured >= auth.authorizedAmount ? 'CAPTURED' : 'PARTIALLY_CAPTURED';

    await tx.authorization.update({
      where: { id: authorizationId },
      data: { capturedAmount: newCaptured, status: newStatus, capturedAt: new Date() },
    });
  });

  await publish({ topic: TOPICS.AUTHORIZATION_EVENTS, key: auth.programId, value: { event: 'card.captured', authorizationId, amount: captureAmountCents.toString() } });
}

// ─── Void ─────────────────────────────────────────────────────────────────────

export async function voidAuthorization(authorizationId: string): Promise<void> {
  const auth = await prisma.authorization.findUnique({
    where: { id: authorizationId },
    include: { card: true },
  });

  if (!auth) throw Errors.authorizationNotFound();
  if (auth.status !== 'PENDING') throw Errors.badRequest('Only PENDING authorizations can be voided');

  const authHoldAccount = await prismaRead.account.findFirst({
    where: { cardId: auth.cardId, accountType: 'AUTH_HOLD' },
    select: { id: true },
  });
  if (!authHoldAccount) throw new Error('AUTH_HOLD account not found');

  const holdAmount = auth.authorizedAmount - auth.capturedAmount;

  await prisma.$transaction(async (tx) => {
    await postVoid({
      authorizationId,
      programId: auth.programId,
      authHoldAccountId: authHoldAccount.id,
      cardAccountId: auth.accountId,
      amount: holdAmount,
      currency: auth.currency,
      tx,
    });

    await tx.authorization.update({
      where: { id: authorizationId },
      data: { status: 'VOIDED', voidedAt: new Date() },
    });
  });
}

// ─── Reversal ─────────────────────────────────────────────────────────────────

export async function reverseAuthorization(authorizationId: string, reversalAmountCents: bigint): Promise<void> {
  const auth = await prisma.authorization.findUnique({
    where: { id: authorizationId },
    include: { card: { include: { program: { select: { floatAccountId: true } } } } },
  });

  if (!auth) throw Errors.authorizationNotFound();
  if (!['CAPTURED', 'PARTIALLY_CAPTURED'].includes(auth.status)) {
    throw Errors.badRequest('Only captured authorizations can be reversed');
  }

  const reversible = auth.capturedAmount - auth.reversedAmount;
  if (reversalAmountCents > reversible) {
    throw Errors.badRequest(`Reversal amount exceeds reversible amount (${reversible})`);
  }

  await prisma.$transaction(async (tx) => {
    await postReversal({
      authorizationId,
      programId: auth.programId,
      floatAccountId: auth.card.program.floatAccountId!,
      cardAccountId: auth.accountId,
      amount: reversalAmountCents,
      currency: auth.currency,
      tx,
    });

    const newReversed = auth.reversedAmount + reversalAmountCents;
    await tx.authorization.update({
      where: { id: authorizationId },
      data: { reversedAmount: newReversed, status: 'REVERSED' },
    });
  });

  await publish({ topic: TOPICS.AUTHORIZATION_EVENTS, key: auth.programId, value: { event: 'card.reversed', authorizationId, amount: reversalAmountCents.toString() } });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function hashCardIdToLockKey(cardId: string): bigint {
  // Derive a stable 64-bit integer from UUID string for pg_advisory_xact_lock
  const hash = crypto.createHash('sha256').update(cardId).digest();
  return hash.readBigInt64BE(0);
}

async function decline(
  cardId: string,
  programId: string,
  declineCode: string,
  input: AuthorizeInput,
  timer: (labels: Record<string, string>) => void,
  fraudScore?: number,
): Promise<AuthorizeResult> {
  timer({ decision: 'decline' });
  authorizationsTotal.inc({ program_id: programId, decision: 'decline', decline_code: declineCode });

  logger.info('Authorization declined', { cardId, programId, declineCode, fraudScore, amount: input.requestedAmountCents.toString() });

  // Create a DECLINED authorization record for audit trail
  try {
    await prisma.authorization.create({
      data: {
        cardId,
        accountId: (await prismaRead.account.findFirst({ where: { cardId, accountType: 'CARD' }, select: { id: true } }))?.id ?? cardId,
        programId,
        status: 'VOIDED',
        requestedAmount: input.requestedAmountCents,
        authorizedAmount: 0n,
        currency: input.currency,
        merchantName: input.merchantName ?? null,
        merchantMcc: input.merchantMcc ?? null,
        merchantCountry: input.merchantCountry ?? null,
        posEntryMode: input.posEntryMode ?? null,
        retrievalRef: input.retrievalRef ?? null,
        authCode: null,
        fraudScore: fraudScore ?? null,
        fraudDecision: 'DECLINE',
        declineCode,
        idempotencyKey: input.idempotencyKey,
        voidedAt: new Date(),
      },
    });
  } catch {/* non-fatal — audit record creation failure doesn't affect the decline response */}

  await publish({ topic: TOPICS.AUTHORIZATION_EVENTS, key: programId, value: { event: 'card.declined', cardId, programId, declineCode, fraudScore } });

  return {
    authorizationId: '',
    authCode: null,
    approved: false,
    approvedAmountCents: 0n,
    declineCode,
    fraudScore,
  };
}

// ─── Fraud engine HTTP client ──────────────────────────────────────────────────

interface FraudResult {
  riskScore: number;
  decision: 'APPROVE' | 'DECLINE' | 'REVIEW';
  declineCode?: string;
  triggeredRules: string[];
}

async function callFraudEngine(params: {
  authorizationId: string;
  vaultToken: string;
  amount: bigint;
  currency: string | undefined;
  merchantMcc: string | undefined;
  merchantCountry: string | undefined;
  posEntryMode: string | undefined;
  ipAddress: string | undefined;
  deviceFingerprint: string | undefined;
  programId: string;
}): Promise<FraudResult> {
  const fraudTimer = fraudEngineLatency.startTimer();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.FRAUD_ENGINE_TIMEOUT_MS);

    const response = await fetch(`${env.FRAUD_ENGINE_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorizationId: params.authorizationId,
        vaultToken: params.vaultToken,
        amount: params.amount.toString(),
        currency: params.currency,
        merchantMcc: params.merchantMcc,
        merchantCountry: params.merchantCountry,
        posEntryMode: params.posEntryMode,
        ipAddress: params.ipAddress,
        deviceFingerprint: params.deviceFingerprint,
        programId: params.programId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    fraudTimer();

    if (!response.ok) throw new Error(`Fraud engine returned ${response.status}`);
    return response.json() as Promise<FraudResult>;
  } catch (err) {
    fraudTimer();
    // Fail-open: if fraud engine is unavailable, approve with score 0
    // This is the correct behavior — don't reject legitimate transactions because of infrastructure issues
    logger.warn('Fraud engine unavailable — failing open', { error: err instanceof Error ? err.message : String(err) });
    return { riskScore: 0, decision: 'APPROVE', triggeredRules: [] };
  }
}
