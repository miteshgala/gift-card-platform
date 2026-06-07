export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ─── Common error factories ───────────────────────────────────────────────────

export const Errors = {
  // Auth
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  totpRequired: () => new AppError(403, 'TOTP_REQUIRED', '2FA code required'),
  invalidTotp: () => new AppError(401, 'INVALID_TOTP_CODE', 'Invalid 2FA code'),
  accountLocked: (retryAfter: Date) => new AppError(429, 'ACCOUNT_LOCKED', 'Account temporarily locked due to too many failed attempts', { retryAfter }),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', 'Token has expired'),
  tokenInvalid: () => new AppError(401, 'TOKEN_INVALID', 'Token is invalid'),
  tokenReuseDetected: () => new AppError(401, 'TOKEN_REUSE_DETECTED', 'Security alert: token reuse detected. All sessions have been invalidated'),
  forbidden: (msg = 'Insufficient permissions') => new AppError(403, 'FORBIDDEN', msg),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required'),

  // Idempotency
  missingIdempotencyKey: () => new AppError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required'),
  invalidIdempotencyKey: () => new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a valid UUID v4'),
  idempotencyKeyReused: () => new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with a different request body'),

  // Cards
  cardNotFound: () => new AppError(404, 'CARD_NOT_FOUND', 'Card not found'),
  cardSuspended: () => new AppError(403, 'CARD_SUSPENDED', 'Card is frozen'),
  cardExpired: () => new AppError(410, 'CARD_EXPIRED', 'Card has expired'),
  cardCancelled: () => new AppError(410, 'CARD_CANCELLED', 'Card has been cancelled'),
  insufficientFunds: (available: bigint, requested: bigint) => new AppError(402, 'INSUFFICIENT_FUNDS', 'Insufficient card balance', { available: available.toString(), requested: requested.toString() }),
  invalidPin: (attemptsRemaining: number) => new AppError(401, 'INVALID_PIN', `Invalid PIN. ${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining`),
  pinLocked: (lockedUntil: Date) => new AppError(423, 'PIN_LOCKED', 'PIN is temporarily locked', { lockedUntil }),
  kycRequired: () => new AppError(403, 'KYC_REQUIRED', 'Identity verification required to use this card'),
  ofacMatch: () => new AppError(403, 'OFAC_MATCH', 'Transaction declined'),

  // Authorizations
  authorizationNotFound: () => new AppError(404, 'AUTHORIZATION_NOT_FOUND', 'Authorization not found'),
  authorizationExpired: () => new AppError(410, 'AUTHORIZATION_EXPIRED', 'Authorization has expired and cannot be captured'),
  captureExceedsAuth: (authorized: bigint, remaining: bigint) => new AppError(422, 'CAPTURE_EXCEEDS_AUTH', 'Capture amount exceeds remaining authorized amount', { authorized: authorized.toString(), remaining: remaining.toString() }),
  fraudDecline: (code?: string) => new AppError(402, 'FRAUD_DECLINE', 'Transaction declined', { declineCode: code }),

  // Programs
  programNotFound: () => new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found'),
  programSuspended: () => new AppError(503, 'PROGRAM_SUSPENDED', 'Program is currently suspended'),
  programBudgetExceeded: () => new AppError(402, 'PROGRAM_BUDGET_EXCEEDED', 'Order would exceed program budget cap'),
  reconciliationHold: () => new AppError(503, 'RECONCILIATION_HOLD', 'Card issuance suspended pending reconciliation review'),

  // Generic
  notFound: (resource: string) => new AppError(404, 'NOT_FOUND', `${resource} not found`),
  badRequest: (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details),
  conflict: (msg: string) => new AppError(409, 'CONFLICT', msg),
  rateLimited: () => new AppError(429, 'RATE_LIMITED', 'Too many requests'),
  internal: () => new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
  invalidAmount: () => new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive integer in minor currency units'),
  invalidCurrency: () => new AppError(400, 'INVALID_CURRENCY', 'Currency not supported by this program'),
};
