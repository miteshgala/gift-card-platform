# Gift Card & Stored Value Platform — Development Prompt

You are an expert full-stack engineer building a **production-grade gift card and stored value platform** from scratch. Every decision you make must reflect how platforms like Blackhawk Network, InComm, Marqeta, and Stripe Issuing are actually built at scale. You are building this to run real money for real businesses. Correctness, auditability, and compliance are not optional.

This prompt is self-contained. Everything you need to make correct architectural and implementation decisions is here. Do not simplify, do not cut corners, and do not defer hard problems to "TODO" comments. Build it right the first time.

---

## Part 1: Non-Negotiable Rules

Before writing a single line of code, internalize these rules. Violating any of them is a critical defect.

### Money
- **All monetary amounts are stored and transmitted as `BIGINT` integers representing minor currency units** (cents for USD, pence for GBP). `$50.00` is stored as `5000`. Never use `FLOAT`, `DOUBLE`, or `DECIMAL` for money calculations in application code.
- **Format for display only at the presentation layer.** All internal business logic operates on `bigint` (TypeScript) and `BIGINT` (PostgreSQL).
- **Never derive a balance from a mutable column.** Balance is always `SUM` of ledger lines. A `balance` column on a card table is a cache, never the source of truth, and if you store one at all it must be read-only and refreshed from the ledger.

### Immutability
- **Financial records are append-only.** Once a journal entry is posted, no field on it ever changes. Corrections are new entries that reverse the original. There is no `UPDATE` on `journal_entries` or `journal_lines` — ever.
- Every posted entry has a `posted_at` timestamp set by the database (`DEFAULT NOW()`), not by the application.

### PCI DSS
- **The application database never stores a raw card number (PAN).** The moment a card number is generated, it goes to the tokenization vault and only a token comes back. The PAN is never written to the app database, never logged, never included in an error message.
- **PINs are stored as bcrypt hashes (cost 12) in a separate table** (`card_pins`) with tighter access controls than the main `cards` table.

### Idempotency
- **Every mutating endpoint requires an `Idempotency-Key` header** (UUID v4, client-supplied). Store `(key, method, normalized_path) → (status, body)` in a `idempotency_keys` table with a 24-hour TTL. On duplicate: return the original response without re-executing. On key reuse with a different body: return 422 `IDEMPOTENCY_KEY_REUSED`.

### CARD Act (US Federal Law)
- **Minimum 5-year card expiry from date of issue.** Enforce this at card creation — if a program requests 1-year expiry, override it to 5 years.
- **No dormancy fee before 12 consecutive months of inactivity.** Enforce this in the dormancy fee job.
- **Dormancy fee cannot exceed remaining card balance.** Never allow a fee to drive a card balance negative.
- **Maximum one dormancy fee per month per card.** Enforce with a uniqueness check before assessment.

### Security
- JWT access tokens signed RS256 (asymmetric). Private key never leaves the API servers. Public key served at `/auth/jwks` for downstream service verification.
- Access tokens expire in 15 minutes. Refresh tokens expire in 7 days, stored as SHA-256 hashes, and rotate on every use.
- Refresh token theft detection: if a used token is presented again, revoke the entire token family and invalidate all sessions for that user.
- All sensitive fields at rest (TOTP secrets, tax IDs, bank account tokens) encrypted with AES-256-GCM under an application-level key stored in HashiCorp Vault or AWS Secrets Manager.
- No secrets in environment variable files on disk in production. All secrets fetched from the secret manager at startup.

---

## Part 2: Technology Stack

Use exactly this stack. Do not substitute without a documented reason.

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22 LTS |
| Language | TypeScript | 5.x strict mode |
| Web framework | Express | 5.x |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 5.x |
| Cache / Locks | Redis | 7 (Cluster mode) |
| Queue | BullMQ | 5.x |
| Event bus | Kafka | 3.x (KafkaJS client) |
| Admin frontend | React 19 + Vite 6 + TailwindCSS 4 | latest |
| Cardholder frontend | React 19 + Vite 6 + TailwindCSS 4 | latest |
| Auth tokens | jsonwebtoken (RS256) | 9.x |
| TOTP | otplib | 12.x |
| Password hashing | bcryptjs | 2.x |
| Schema validation | Zod | 3.x |
| Process manager | PM2 (dev) / Docker + ECS (prod) | latest |
| Metrics | prom-client | 15.x |
| Logging | Winston (JSON structured) | 3.x |
| Testing | Vitest + Supertest | latest |
| Contract testing | Bruno (API collections) | latest |

---

## Part 3: Repository Structure

```
/
├── services/
│   ├── api/                    # Core platform modular monolith
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── cards/
│   │   │   │   ├── ledger/
│   │   │   │   ├── programs/
│   │   │   │   ├── campaigns/
│   │   │   │   ├── orders/
│   │   │   │   ├── compliance/
│   │   │   │   ├── settlement/
│   │   │   │   ├── fraud/
│   │   │   │   ├── kyc/
│   │   │   │   ├── reports/
│   │   │   │   ├── webhooks/
│   │   │   │   ├── notifications/
│   │   │   │   ├── users/
│   │   │   │   ├── disputes/
│   │   │   │   └── integrations/
│   │   │   ├── shared/
│   │   │   │   ├── middleware/
│   │   │   │   ├── errors/
│   │   │   │   ├── events/
│   │   │   │   ├── db/
│   │   │   │   ├── redis/
│   │   │   │   ├── kafka/
│   │   │   │   └── utils/
│   │   │   ├── prisma/
│   │   │   │   ├── schema.prisma
│   │   │   │   ├── migrations/
│   │   │   │   └── seed.ts
│   │   │   └── app.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── vault/                  # Tokenization vault — PCI isolated process
│   │   ├── src/
│   │   │   ├── tokenize.ts
│   │   │   ├── reveal.ts
│   │   │   ├── crypto.ts
│   │   │   └── app.ts
│   │   ├── prisma/
│   │   └── package.json
│   │
│   ├── fraud/                  # Fraud decisioning engine
│   │   ├── src/
│   │   │   ├── layers/
│   │   │   │   ├── hard-blocks.ts
│   │   │   │   ├── velocity.ts
│   │   │   │   ├── ml-scorer.ts
│   │   │   │   └── review-queue.ts
│   │   │   └── app.ts
│   │   └── package.json
│   │
│   └── worker/                 # BullMQ workers (same codebase as api, separate process)
│       └── src/
│           ├── jobs/
│           │   ├── card-issuance.ts
│           │   ├── auth-expiry-sweep.ts
│           │   ├── dormancy-assessment.ts
│           │   ├── escheatment-scan.ts
│           │   ├── reconciliation.ts
│           │   ├── breakage-recognition.ts
│           │   ├── settlement-run.ts
│           │   ├── gl-export.ts
│           │   ├── webhook-delivery.ts
│           │   └── balance-checkpoint.ts
│           └── scheduler.ts
│
├── frontends/
│   ├── admin/                  # Admin portal SPA
│   └── cardholder/             # Public cardholder portal SPA
│
├── infra/
│   ├── docker-compose.yml      # Local dev (all services)
│   ├── docker-compose.prod.yml # Production
│   ├── nginx/
│   └── k8s/                    # Kubernetes manifests (or ECS task definitions)
│
├── docs/
│   └── platform-architecture.md
│
└── package.json                # Workspace root
```

Each `module/` directory follows this internal structure:
```
modules/cards/
  ├── cards.controller.ts   — HTTP handlers only, no business logic
  ├── cards.service.ts      — All business logic
  ├── cards.routes.ts       — Express router + middleware chain
  ├── cards.schema.ts       — Zod request/response schemas
  ├── cards.types.ts        — TypeScript types/interfaces
  └── cards.test.ts         — Unit + integration tests
```

---

## Part 4: Database Schema

Implement this schema exactly. Every table, column, index, and constraint matters.

### 4.1 Foundational Rules

- All primary keys are `UUID` generated with `gen_random_uuid()` (requires `pgcrypto` extension)
- All timestamps are `TIMESTAMPTZ` stored in UTC
- All monetary amounts are `BIGINT` (minor currency units)
- All `status` and `type` columns use `TEXT` with a `CHECK` constraint — do not use PostgreSQL `ENUM` types (they are painful to ALTER in production)
- All tables have `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- Mutable tables have `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` with a trigger to auto-update it

### 4.2 Core Schema

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ─── PROGRAMS ────────────────────────────────────────────────────────────────
CREATE TABLE programs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  description           TEXT,
  currency              CHAR(3) NOT NULL DEFAULT 'USD',
  open_loop             BOOLEAN NOT NULL DEFAULT FALSE,
  card_expiry_days      INTEGER NOT NULL DEFAULT 1825 CHECK (card_expiry_days >= 1825),
  dormancy_fee_cents    BIGINT NOT NULL DEFAULT 0 CHECK (dormancy_fee_cents >= 0),
  dormancy_months       INTEGER NOT NULL DEFAULT 12 CHECK (dormancy_months >= 12),
  budget_cap            BIGINT CHECK (budget_cap IS NULL OR budget_cap > 0),
  approval_threshold    BIGINT NOT NULL DEFAULT 500000,
  auto_approve_limit    BIGINT NOT NULL DEFAULT 100000,
  kyc_required_above    BIGINT,
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','SUSPENDED','SUSPENDED_RECON','ARCHIVED')),
  float_account_id      UUID,  -- FK added after accounts table
  liability_account_id  UUID,
  breakage_account_id   UUID,
  fee_account_id        UUID,
  escrow_account_id     UUID,
  owner_party_id        UUID,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ACCOUNTS ────────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type   TEXT NOT NULL CHECK (account_type IN (
                   'CARD','FLOAT','LIABILITY_RESERVE','BREAKAGE',
                   'FEE_INCOME','ESCROW','SETTLEMENT_SUSPENSE','AUTH_HOLD')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  currency       CHAR(3) NOT NULL,
  program_id     UUID REFERENCES programs(id),
  card_id        UUID,  -- FK added after cards table
  party_id       UUID,  -- FK added after settlement_parties table
  label          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ
);
CREATE INDEX accounts_card_id_idx    ON accounts(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX accounts_program_idx    ON accounts(program_id);
CREATE INDEX accounts_type_status    ON accounts(account_type, status);

-- ─── JOURNAL ENTRIES ─────────────────────────────────────────────────────────
CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type       TEXT NOT NULL CHECK (entry_type IN (
                     'LOAD','AUTH','CAPTURE','REVERSAL','VOID','REFUND','FEE',
                     'ADJUSTMENT','ESCHEAT','BREAKAGE_RECOGNITION','SETTLEMENT',
                     'RELOAD','DISPUTE_CREDIT','DISPUTE_REVERSAL')),
  status           TEXT NOT NULL DEFAULT 'POSTED'
                     CHECK (status IN ('PENDING','POSTED','VOIDED')),
  idempotency_key  TEXT UNIQUE,
  authorization_id UUID,  -- FK added after authorizations table
  order_id         UUID,
  program_id       UUID NOT NULL REFERENCES programs(id),
  initiated_by     UUID,  -- FK to users
  external_ref     TEXT,
  description      TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX je_program_id_idx   ON journal_entries(program_id);
CREATE INDEX je_entry_type_idx   ON journal_entries(entry_type);
CREATE INDEX je_posted_at_idx    ON journal_entries(posted_at DESC);
CREATE INDEX je_idempotency_idx  ON journal_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── JOURNAL LINES ────────────────────────────────────────────────────────────
CREATE TABLE journal_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES journal_entries(id),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  direction   TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  currency    CHAR(3) NOT NULL,
  sequence    SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX jl_account_id_idx      ON journal_lines(account_id);
CREATE INDEX jl_entry_id_idx        ON journal_lines(entry_id);
CREATE INDEX jl_account_created_idx ON journal_lines(account_id, created_at DESC);

-- Balance constraint: every entry must have equal debits and credits
-- Implement as a DEFERRABLE constraint trigger (deferred until end of transaction)
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  debit_sum  BIGINT; credit_sum BIGINT;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)
  INTO debit_sum, credit_sum
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF debit_sum <> credit_sum THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=% credits=%',
      NEW.entry_id, debit_sum, credit_sum;
  END IF;
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- ─── BALANCE CHECKPOINTS ──────────────────────────────────────────────────────
CREATE TABLE balance_checkpoints (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id),
  balance        BIGINT NOT NULL,
  currency       CHAR(3) NOT NULL,
  checkpoint_at  TIMESTAMPTZ NOT NULL,
  last_entry_id  UUID NOT NULL REFERENCES journal_entries(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, checkpoint_at)
);
CREATE INDEX bc_account_checkpoint_idx ON balance_checkpoints(account_id, checkpoint_at DESC);

-- ─── SETTLEMENT PARTIES ───────────────────────────────────────────────────────
CREATE TABLE settlement_parties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type            TEXT NOT NULL CHECK (party_type IN (
                          'FRANCHISEE','COALITION_BRAND','MARKETPLACE_SELLER',
                          'DISTRIBUTOR','WHITE_LABEL_CLIENT','PROGRAM_OWNER')),
  name                  TEXT NOT NULL,
  legal_name            TEXT NOT NULL,
  tax_id                TEXT,  -- AES-256-GCM encrypted
  settlement_currency   CHAR(3) NOT NULL DEFAULT 'USD',
  settlement_frequency  TEXT NOT NULL DEFAULT 'WEEKLY'
                          CHECK (settlement_frequency IN ('DAILY','WEEKLY','BIWEEKLY','MONTHLY')),
  bank_account_token    TEXT,  -- vault token for bank routing/account numbers
  float_account_id      UUID REFERENCES accounts(id),
  suspense_account_id   UUID REFERENCES accounts(id),
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','SUSPENDED','OFFBOARDED')),
  parent_party_id       UUID REFERENCES settlement_parties(id),
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CARDS ───────────────────────────────────────────────────────────────────
CREATE TABLE cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  campaign_id     UUID REFERENCES campaigns(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  vault_token     TEXT NOT NULL UNIQUE,
  last4           CHAR(4) NOT NULL,
  bin             VARCHAR(8) NOT NULL,
  card_type       TEXT NOT NULL CHECK (card_type IN ('PHYSICAL','VIRTUAL','SINGLE_USE')),
  status          TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION' CHECK (status IN (
                    'PENDING_ACTIVATION','ACTIVE','SUSPENDED','EXPIRED',
                    'CANCELLED','ESHEATED')),
  currency        CHAR(3) NOT NULL,
  initial_load    BIGINT NOT NULL CHECK (initial_load > 0),
  expires_at      TIMESTAMPTZ NOT NULL,
  activated_at    TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  kyc_status      TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (kyc_status IN (
                    'NOT_REQUIRED','PENDING','APPROVED','REJECTED','EXPIRED')),
  recipient_name  TEXT,
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_state CHAR(2),  -- for escheatment jurisdiction
  department_id   UUID REFERENCES departments(id),
  issued_by       UUID REFERENCES users(id),
  order_id        UUID REFERENCES orders(id),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cards_program_id_idx   ON cards(program_id);
CREATE INDEX cards_status_idx       ON cards(status);
CREATE INDEX cards_expires_at_idx   ON cards(expires_at);
CREATE INDEX cards_last_used_idx    ON cards(last_used_at);
CREATE INDEX cards_vault_token_idx  ON cards(vault_token);
CREATE INDEX cards_order_id_idx     ON cards(order_id) WHERE order_id IS NOT NULL;

CREATE TABLE card_pins (
  card_id          UUID PRIMARY KEY REFERENCES cards(id),
  pin_hash         TEXT NOT NULL,  -- bcrypt cost 12
  attempt_count    SMALLINT NOT NULL DEFAULT 0,
  locked_at        TIMESTAMPTZ,
  last_changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUTHORIZATIONS ──────────────────────────────────────────────────────────
CREATE TABLE authorizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           UUID NOT NULL REFERENCES cards(id),
  account_id        UUID NOT NULL REFERENCES accounts(id),
  program_id        UUID NOT NULL REFERENCES programs(id),
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                      'PENDING','CAPTURED','PARTIALLY_CAPTURED',
                      'REVERSED','VOIDED','EXPIRED')),
  requested_amount  BIGINT NOT NULL CHECK (requested_amount > 0),
  authorized_amount BIGINT NOT NULL CHECK (authorized_amount >= 0),
  captured_amount   BIGINT NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  reversed_amount   BIGINT NOT NULL DEFAULT 0 CHECK (reversed_amount >= 0),
  currency          CHAR(3) NOT NULL,
  merchant_name     TEXT,
  merchant_mcc      CHAR(4),
  merchant_country  CHAR(2),
  pos_entry_mode    TEXT CHECK (pos_entry_mode IN ('CHIP','SWIPE','CONTACTLESS','ECOM','MANUAL')),
  retrieval_ref     TEXT,
  auth_code         CHAR(6),
  fraud_score       SMALLINT CHECK (fraud_score BETWEEN 0 AND 100),
  fraud_decision    TEXT CHECK (fraud_decision IN ('APPROVE','DECLINE','REVIEW')),
  decline_code      TEXT,
  idempotency_key   TEXT UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  authorized_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_at       TIMESTAMPTZ,
  voided_at         TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  -- Capture amount constraint
  CHECK (captured_amount + reversed_amount <= authorized_amount)
);
CREATE INDEX auth_card_id_idx        ON authorizations(card_id);
CREATE INDEX auth_status_idx         ON authorizations(status);
CREATE INDEX auth_expires_at_idx     ON authorizations(expires_at) WHERE status = 'PENDING';
CREATE INDEX auth_retrieval_ref_idx  ON authorizations(retrieval_ref) WHERE retrieval_ref IS NOT NULL;
```

Implement the remaining tables (`users`, `refresh_tokens`, `api_keys`, `programs`, `campaigns`, `departments`, `orders`, `order_line_items`, `kyc_checks`, `sar_filings`, `dormancy_assessments`, `escheatment_records`, `escheatment_filings`, `fraud_flags`, `velocity_rules`, `device_fingerprints`, `settlement_runs`, `settlement_lines`, `redemption_party_links`, `idempotency_keys`, `disputes`, `wallet_tokens`, `pending_reloads`, `webhooks`, `webhook_deliveries`, `audit_logs`, `gl_mappings`, `hr_event_rules`, `model_registry`, `key_rotation_jobs`, `balance_checkpoints`) following the same conventions.

### 4.3 Updated_At Trigger (apply to all mutable tables)

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- Apply to each mutable table:
CREATE TRIGGER cards_updated_at BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- (repeat for programs, users, authorizations, etc.)
```

---

## Part 5: Ledger Service

Implement `services/api/src/modules/ledger/ledger.service.ts` as the single entry point for all financial operations. No other module posts directly to `journal_lines`. They call the ledger service.

### 5.1 postEntry

```typescript
interface EntryLine {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;       // must be positive
  currency: string;
}

interface PostEntryInput {
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
  tx?: Prisma.TransactionClient;  // pass when called inside an existing transaction
}

async function postEntry(input: PostEntryInput): Promise<JournalEntry>
```

This function must:
1. Validate that `SUM(debits) === SUM(credits)` before writing — fail fast in app code before hitting the DB constraint
2. Validate that all `accountId` values belong to the same `programId` or are system accounts
3. Wrap insert of `journal_entries` + all `journal_lines` in a single DB transaction
4. Check idempotency key first — if found, return the cached entry without re-inserting
5. Emit a `ledger.entry.posted` Kafka event after commit

### 5.2 getBalance

```typescript
async function getBalance(accountId: string): Promise<{ balance: bigint; currency: string }>
```

Algorithm:
1. Load latest `balance_checkpoints` record for the account
2. Sum all `journal_lines` joined to `journal_entries` (status = 'POSTED', posted_at > checkpoint.checkpoint_at)
3. Apply sign based on account's `normal_balance` vs line `direction`
4. Return `checkpoint.balance + incremental`
5. Cache result in Redis for 5 seconds (write-through invalidated on every new line for this account)

For CREDIT-normal accounts (CARD, LIABILITY_RESERVE, BREAKAGE, FEE_INCOME, ESCROW):
- `balance += amount` when direction = 'CREDIT'
- `balance -= amount` when direction = 'DEBIT'

For DEBIT-normal accounts (FLOAT, SETTLEMENT_SUSPENSE):
- `balance += amount` when direction = 'DEBIT'
- `balance -= amount` when direction = 'CREDIT'

### 5.3 Entry Templates

Implement these exact double-entry templates as named functions:

```typescript
// Card issuance: $50 loaded onto card
// DR FLOAT +5000, CR CARD_ACCOUNT +5000
async function postLoad(cardId: string, amount: bigint, orderId?: string): Promise<void>

// Authorization hold: $25 reserved
// DR CARD_ACCOUNT +2500, CR AUTH_HOLD +2500
async function postAuth(authorizationId: string): Promise<void>

// Capture: merchant settles $25
// DR AUTH_HOLD +2500, CR FLOAT +2500
async function postCapture(authorizationId: string, captureAmount: bigint): Promise<void>

// Void: auth cancelled (no capture)
// DR AUTH_HOLD +2500, CR CARD_ACCOUNT +2500
async function postVoid(authorizationId: string): Promise<void>

// Reversal: refund after capture
// DR FLOAT +2500, CR CARD_ACCOUNT +2500
async function postReversal(authorizationId: string, reversalAmount: bigint): Promise<void>

// Dormancy fee
// DR CARD_ACCOUNT +150, CR FEE_INCOME +150
async function postDormancyFee(cardId: string, feeAmount: bigint): Promise<void>

// Breakage recognition
// DR LIABILITY_RESERVE +amount, CR BREAKAGE +amount
async function postBreakageRecognition(programId: string, amount: bigint): Promise<void>

// Escheatment: move remaining balance to escrow
// DR CARD_ACCOUNT +balance, CR ESCROW +balance
async function postEscheatment(cardId: string): Promise<void>

// Reload / top-up (Stripe payment captured)
// DR FLOAT +amount, CR CARD_ACCOUNT +amount
async function postReload(cardId: string, amount: bigint, stripePaymentIntentId: string): Promise<void>

// Dispute provisional credit
// DR FLOAT +amount, CR CARD_ACCOUNT +amount
async function postDisputeCredit(disputeId: string): Promise<void>
```

---

## Part 6: Authorization / Capture Pipeline

### 6.1 Authorization Endpoint

`POST /api/v1/authorize`

This is the hottest path in the system. Target latency: p99 < 150ms. Every microsecond counts.

Processing sequence (implement exactly in this order):

```
1.  Check idempotency key (Redis lookup — 1ms)
2.  Load card from DB (read replica — indexed by vault_token)
3.  Layer 1 fraud check: hard blocks (card status, expiry, program status — in-memory)
4.  Verify PIN if provided (bcrypt.compare — ~100ms, do this early to fail fast)
5.  Call fraud engine (gRPC with 80ms deadline — fail open after deadline)
6.  If fraud_decision = 'DECLINE' → return 402 immediately
7.  Load card account balance (Redis cache → checkpoint + incremental)
8.  Check: available_balance >= requested_amount (fail: 402 INSUFFICIENT_FUNDS)
9.  Acquire per-card advisory lock: SELECT pg_advisory_xact_lock(hashtext(card_id))
    (This serializes concurrent auths on the same card for the duration of step 10-12 only)
10. Re-check balance inside the transaction (double-check after acquiring lock)
11. Write authorizations row + postAuth() ledger entry — single DB transaction
12. Release advisory lock (auto-released at transaction commit)
13. Store idempotency result in Redis (TTL 24h)
14. Emit 'card.authorized' Kafka event
15. Return 200 with authorizationId + authCode
```

Auth code: 6 random alphanumeric characters (`crypto.randomBytes(3).toString('hex').toUpperCase()`).

### 6.2 Capture Endpoint

`POST /api/v1/authorizations/:id/capture`

```
1. Load authorization (verify status = 'PENDING')
2. Validate: captureAmount <= authorized_amount - captured_amount
3. Validate: authorization not expired (expires_at > NOW())
4. Write capture to DB + postCapture() ledger entry
5. Update authorization: captured_amount += captureAmount, status = 'CAPTURED' or 'PARTIALLY_CAPTURED'
6. Emit 'card.captured' Kafka event
```

### 6.3 Authorization Expiry Sweeper (BullMQ job)

Schedule: every 15 minutes.
Query: `SELECT * FROM authorizations WHERE status = 'PENDING' AND expires_at < NOW()`
For each: `postVoid()` + update status to `'EXPIRED'`

---

## Part 7: Tokenization Vault

Implement as a completely separate Express application at `services/vault/`.

The vault has its own PostgreSQL database and its own Redis instance. It accepts connections only from the core API over mTLS (mutual TLS — both sides present client certificates). In local dev, use self-signed certs. In production, use ACM private CA or Vault PKI secrets engine.

### 7.1 Vault Database Schema

```sql
CREATE TABLE vault_records (
  token       TEXT PRIMARY KEY,           -- deterministic HMAC-based token
  ciphertext  TEXT NOT NULL,              -- AES-256-GCM encrypted PAN
  iv          TEXT NOT NULL,              -- initialization vector (base64)
  key_version INTEGER NOT NULL,           -- which DEK was used
  last4       CHAR(4) NOT NULL,
  bin         VARCHAR(8) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vault_reveal_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT NOT NULL,
  requester_id TEXT NOT NULL,   -- user or service ID
  reason       TEXT NOT NULL,
  ip_address   INET,
  revealed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vrl_token_idx ON vault_reveal_log(token);
CREATE INDEX vrl_revealed_at_idx ON vault_reveal_log(revealed_at DESC);

CREATE TABLE encryption_keys (
  version      INTEGER PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('ACTIVE','ROTATING','RETIRED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at   TIMESTAMPTZ
);
```

### 7.2 Token Generation (Deterministic)

```typescript
function generateToken(pan: string, environment: 'live' | 'test'): string {
  const hmac = crypto.createHmac('sha256', TOKENIZATION_KEY);
  hmac.update(pan);
  const hash = hmac.digest('hex');
  // base62 encode first 22 chars of the hash
  const token = base62Encode(Buffer.from(hash.slice(0, 16), 'hex'));
  return `tok_${environment}_${token}`;
}
```

Determinism means the same PAN always produces the same token — enabling dedup checks without ever storing the PAN in the app DB.

### 7.3 Vault API Surface

```
POST  /tokens           { pan }           → { token, last4, bin }
GET   /tokens/:token                      → { token, last4, bin, keyVersion }
POST  /reveal           { token, requesterId, reason } → { pan }
DELETE /tokens/:token                     → 204 (GDPR erasure)
```

`POST /reveal` must:
1. Rate limit: max 10 reveals/minute per token
2. Write to `vault_reveal_log`
3. Never appear in application logs — set `X-No-Log: true` header and strip in nginx
4. Return `Cache-Control: no-store` on the response

---

## Part 8: Fraud Decisioning Engine

Implement at `services/fraud/` as a separate Express application. The core API calls it via HTTP with a 80ms timeout (not gRPC unless you add the protobuf toolchain — HTTP/2 is acceptable here).

### 8.1 Four Layers

**Layer 1 — Hard Blocks** (sync, ~0ms, run in the core API before calling the fraud service):
- Card status is not `ACTIVE` → `DECLINE / CARD_SUSPENDED`
- Card `expires_at < NOW()` → `DECLINE / CARD_EXPIRED`
- Program status is not `ACTIVE` → `DECLINE / PROGRAM_SUSPENDED`

**Layer 2 — Velocity Rules** (sync, ~5ms, evaluated in fraud service using Redis):

Load all `velocity_rules` for the program into Redis on startup. Refresh on rule change events (subscribe to `velocity_rules_updated` Kafka topic).

For each rule, use a Redis sorted set keyed by `vel:{scope}:{entity_id}:{rule_id}`:
- `ZADD key <timestamp_ms> <txn_id>` on each transaction
- `ZREMRANGEBYSCORE key -inf <window_start>` to expire old members
- `ZCARD key` for count check, `ZSCORE` sum for amount check
- Use `MULTI`/`EXEC` pipeline to batch all checks for a single authorization

**Layer 3 — ML Scoring** (~20ms, computed in fraud service):
For v1, implement a rule-based scoring approximation that assigns a risk score 0-100 based on weighted signals:
- Transaction amount vs. historical average for this card: 0-30 points
- Merchant MCC risk tier: 0-20 points (predefined MCC risk map)
- Time of day / day of week anomaly: 0-15 points
- Repeated declinations in the last hour: 0-20 points
- IP geolocation vs. cardholder state: 0-15 points

Document the interface clearly so a real ML model can replace this scoring function without changing the surrounding code.

**Layer 4 — Human Review Queue** (async, BullMQ job):
Any authorization with score >= 60 is added to the `fraud-review` queue. Support agents see this in the admin portal. Retroactive action (card suspend + reversal) is a manual admin operation.

### 8.2 Fraud Engine API

```
POST /score
Request:  { authorizationId, vaultToken, amount, currency, merchantMcc,
            merchantCountry, posEntryMode, ipAddress, deviceFingerprint,
            recentTransactions: [{ amount, merchantMcc, authorizedAt }] }
Response: { riskScore, decision, declineCode?, triggeredRules[] }
Response time guarantee: always respond within 80ms; if processing takes longer,
  return last computed result or { riskScore: 0, decision: 'APPROVE' } (fail-open)
```

---

## Part 9: Identity & Access Management

### 9.1 User Lifecycle

All users are **invite-only**. There is no self-registration endpoint. The flow is:
1. Admin calls `POST /api/v1/users/invite` → generates a cryptographically random invite token → sends email with link
2. Recipient clicks link → `GET /accept-invite?token=<token>` → validates token not expired (72h)
3. Recipient sets password → `POST /api/v1/auth/accept-invite` → account activated

### 9.2 Login Flow

```
POST /api/v1/auth/login
  1. Find user by email (use constant-time comparison to prevent timing attacks)
  2. If not found: return generic 401 'INVALID_CREDENTIALS' — never reveal if email exists
  3. Check account status (INVITED, SUSPENDED, DEACTIVATED → 401 'INVALID_CREDENTIALS')
  4. Check email verified (false → 401 'INVALID_CREDENTIALS' — same generic message)
  5. Check account lockout (failed_attempts >= 5 AND locked_until > NOW() → 429)
  6. Verify password (bcrypt.compare)
  7. If password wrong: increment failed_attempts, set locked_until if >= 5 fails → 401
  8. If TOTP enabled: validate totpCode using otplib
     - If totpCode missing: return 403 'TOTP_REQUIRED' (not a generic error)
     - If totpCode wrong: 401 'INVALID_TOTP_CODE'
  9. Reset failed_attempts to 0
 10. Issue access token (RS256 JWT, 15min) + refresh token (rotate on use)
 11. Write audit log entry
 12. Return { accessToken, refreshToken, expiresAt }
```

JWT payload:
```typescript
{
  sub: userId,
  email: user.email,
  role: user.role,
  programId: user.programId ?? null,
  iat: now,
  exp: now + 900,   // 15 minutes
  jti: crypto.randomUUID(),  // for revocation if needed
}
```

### 9.3 Refresh Token Rotation

```
POST /api/v1/auth/refresh  { refreshToken }
  1. Hash the presented token (SHA-256)
  2. Look up refresh_tokens by token_hash
  3. If not found or expired: 401
  4. If found but replaced_by is not null (already used): revoke entire family → 401 'TOKEN_REUSE_DETECTED'
  5. Generate new access token + new refresh token
  6. Mark old refresh token as replaced_by = new token id
  7. Return new tokens
```

### 9.4 RBAC Middleware

```typescript
// Usage:
router.get('/cards', authenticate, authorize('PROGRAM_ADMIN', 'PROGRAM_ANALYST', 'SUPPORT_AGENT'), controller.list);

function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    // Also enforce program scoping: non-SUPER_ADMINs can only access their own program's data
    next();
  };
}
```

---

## Part 10: Compliance Engine (BullMQ Jobs)

### 10.1 Dormancy Fee Assessment

Schedule: daily at 2:00 AM UTC. Job: `dormancy-assessment`.

```typescript
// For each active program with dormancy_fee_cents > 0:
//   Find all ACTIVE cards where last_used_at < (NOW() - dormancy_months)
//   For each: check no fee assessed this calendar month
//   Assess fee = MIN(program.dormancy_fee_cents, current_balance)
//   If fee > 0: postDormancyFee(), create dormancy_assessments record
//   If remaining balance = 0 after fee: mark card CANCELLED
```

### 10.2 Escheatment Scanner

Schedule: 1st of every month at 3:00 AM UTC. Job: `escheatment-scan`.

```typescript
const STATE_DORMANCY_YEARS: Record<string, number> = {
  AL:3, AK:3, AZ:3, AR:3, CA:3, CO:3, CT:3, DE:5, FL:3, GA:3,
  HI:3, ID:3, IL:3, IN:3, IA:3, KS:3, KY:3, LA:3, ME:3, MD:3,
  MA:3, MI:3, MN:3, MS:3, MO:5, MT:3, NE:3, NV:3, NH:5, NJ:3,
  NM:3, NY:3, NC:3, ND:3, OH:3, OK:3, OR:3, PA:3, RI:3, SC:3,
  SD:3, TN:3, TX:3, UT:3, VT:3, VA:3, WA:3, WV:3, WI:3, WY:3, DC:3,
};
// For each state, find cards where:
//   last_used_at < (NOW() - dormancy_years)
//   recipient_state = state_code
//   status = 'ACTIVE'
//   no existing escheatment_record
// Create escheatment_record with status='PENDING'
// Generate NAUPA HRS9 format file quarterly, upload to S3, update filing status
```

### 10.3 Breakage Recognition

Schedule: 1st of every month at 4:00 AM UTC. Job: `breakage-recognition`.

Compute breakage rate from trailing 24-month cohort data:
```
breakage_rate = 1 - (redemption_volume_in_period / cards_issued_in_period)
```
Post one `BREAKAGE_RECOGNITION` journal entry per program.

### 10.4 Float Reconciliation

Schedule: daily at 1:00 AM UTC. Job: `reconciliation`.

```typescript
for each active program:
  float_balance = getBalance(program.float_account_id)
  total_card_balances = SUM of getBalance(card.account_id) for all ACTIVE cards in program
  pending_holds = SUM(authorized_amount) FROM authorizations WHERE status='PENDING' AND program_id=?
  expected_float = total_card_balances + pending_holds
  variance = float_balance - expected_float
  if |variance| > 100:  // > $1.00
    emit RECONCILIATION_CRITICAL alert
    set program.status = 'SUSPENDED_RECON'
  log ReconReport to reconciliation_logs table
```

### 10.5 OFAC Screening

Call on every card activation and every authorization for amounts > $500:
```typescript
async function screenOfac(name: string, country: string): Promise<boolean>
// Returns true if match found
// Integrate with chosen vendor (Dow Jones, Refinitiv, or free OFAC SDN list API)
// Match threshold: fuzzy score >= 85
// On match: freeze card, create fraud_flag (severity: CRITICAL, source: 'OFAC'), alert compliance team
```

---

## Part 11: API Design — All Endpoints

Implement every endpoint below. Every mutating endpoint must enforce idempotency. Every response must follow the envelope format.

**Response envelope:**
```typescript
// Success
{ data: T, meta: { requestId: string, version: string, page?: number, pageSize?: number, total?: number, nextCursor?: string } }

// Error
{ error: { code: string, message: string, requestId: string, details?: unknown } }
```

### Auth (`/api/v1/auth`)
- `POST /login` — email + password + optional TOTP
- `POST /refresh` — rotate refresh token
- `POST /logout` — revoke refresh token
- `POST /forgot-password` — send reset email (always return 200, never reveal if email exists)
- `POST /reset-password` — consume reset token, set new password
- `POST /accept-invite` — set password from invite token
- `GET  /me` — current user profile
- `POST /totp/setup` — generate TOTP secret + QR code
- `POST /totp/verify` — confirm TOTP setup
- `POST /totp/disable` — disable TOTP (requires current TOTP code)
- `GET  /jwks` — public keys for JWT verification (public, no auth)

### Cards (`/api/v1/cards`)
- `GET    /` — list cards (paginated, cursor-based, filterable by status/program/campaign)
- `POST   /` — issue a single card
- `GET    /:id` — card detail (includes derived balance, last 5 transactions)
- `PATCH  /:id/suspend` — freeze card
- `PATCH  /:id/unsuspend` — unfreeze card
- `POST   /:id/adjust` — manual balance adjustment (SUPER_ADMIN only, requires reason)
- `GET    /:id/transactions` — paginated transaction history
- `POST   /:id/reload` — initiate reload (returns Stripe PaymentIntent clientSecret)
- `DELETE /:id` — cancel card (sets status CANCELLED, posts reversal of remaining balance)

### Cardholder Portal (`/api/v1/cardholder`) — public, card+PIN auth
- `POST /auth` — authenticate with card number + PIN → short-lived cardholder JWT
- `GET  /balance` — current balance
- `GET  /transactions` — transaction history
- `POST /pin/change` — change PIN (requires current PIN)
- `POST /pin/reset` — request PIN reset via email OTP
- `POST /freeze` — self-service card freeze
- `POST /register` — register card to email/phone for notifications
- `POST /disputes` — submit a dispute
- `POST /wallet/provision` — initiate Apple Pay / Google Pay provisioning

### Authorizations (`/api/v1`)
- `POST /authorize` — create authorization
- `POST /authorizations/:id/capture` — capture
- `POST /authorizations/:id/void` — void pending auth
- `POST /authorizations/:id/reverse` — partial or full reversal of captured amount

### Orders (`/api/v1/orders`) — bulk card issuance
- `GET    /` — list orders
- `POST   /` — create order (JSON body or CSV upload)
- `GET    /:id` — order status + line items
- `POST   /:id/approve` — approve pending-approval order
- `DELETE /:id` — cancel pending order

### Programs (`/api/v1/programs`)
- `GET    /` — list programs
- `POST   /` — create program (SUPER_ADMIN only)
- `GET    /:id` — program detail
- `PATCH  /:id` — update program settings
- `GET    /:id/accounts` — list program accounts with balances
- `GET    /:id/reconciliation` — latest reconciliation report

### Campaigns, Departments
- Full CRUD under `/api/v1/campaigns` and `/api/v1/departments`

### Users (`/api/v1/users`)
- `GET    /` — list users
- `POST   /invite` — invite user by email
- `GET    /:id` — user detail
- `PATCH  /:id/role` — change role
- `PATCH  /:id/deactivate` — deactivate user

### API Keys (`/api/v1/settings/api-keys`)
- `GET    /` — list keys (prefix + metadata only, never full key)
- `POST   /` — create key (full key shown once in response, then never again)
- `DELETE /:id` — revoke key

### KYC (`/api/v1/kyc`)
- `GET    /` — list KYC checks (filterable by status)
- `GET    /:id` — check detail
- `POST   /:id/approve` — approve check
- `POST   /:id/reject` — reject check

### Fraud (`/api/v1/fraud`)
- `GET    /flags` — list fraud flags
- `POST   /flags/:id/resolve` — resolve flag
- `GET    /velocity-rules` — list rules
- `POST   /velocity-rules` — create rule
- `PATCH  /velocity-rules/:id` — update rule
- `DELETE /velocity-rules/:id` — delete rule

### Settlement (`/api/v1/settlement`)
- `GET    /parties` — list settlement parties
- `POST   /parties` — create party
- `GET    /runs` — list settlement runs
- `POST   /runs` — trigger manual settlement run
- `POST   /runs/:id/approve` — approve run for payment

### Reports (`/api/v1/reports`)
- `GET    /liability` — outstanding liability by program (JSON + CSV export)
- `GET    /breakage` — breakage by cohort (JSON + CSV)
- `GET    /escheatment` — escheatment candidates and filed records
- `GET    /reconciliation` — daily reconciliation history
- `GET    /fraud` — fraud flags and velocity analytics
- `GET    /settlement` — settlement run history

### Disputes (`/api/v1/disputes`)
- `GET    /` — list disputes
- `GET    /:id` — dispute detail
- `POST   /:id/assign` — assign to agent
- `POST   /:id/resolve` — resolve (win/lose)

### Webhooks (`/api/v1/webhooks`)
- `GET    /endpoints` — list endpoints
- `POST   /endpoints` — add endpoint
- `PATCH  /endpoints/:id` — update endpoint
- `DELETE /endpoints/:id` — remove endpoint
- `GET    /endpoints/:id/deliveries` — delivery log with retry status

### Audit (`/api/v1/audit-log`)
- `GET    /` — paginated audit log (filterable by category, actor, date range)

### HR Integration (`/api/v1/hr-integration`)
- `GET    /` — list program event configurations
- `PATCH  /programs/:id` — set event denominations for a program
- `POST   /events` — inbound HR event webhook (authenticated by HMAC signature)

---

## Part 12: Shared Middleware

Implement these middleware components in `services/api/src/shared/middleware/`:

### 12.1 Request ID

Attach a UUID to every request. Include in all log lines and responses.
```typescript
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] as string ?? crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
```

### 12.2 Idempotency Middleware

Apply to all `POST`, `PATCH`, `DELETE` routes (except `/auth/login` and `/auth/refresh`):
```typescript
async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return res.status(400).json({ error: { code: 'MISSING_IDEMPOTENCY_KEY' } });
  if (!isUUID(key)) return res.status(400).json({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });

  const cached = await db.idempotencyKeys.findFirst({
    where: { key, method: req.method, path: normalizedPath(req.path) }
  });
  if (cached) {
    const requestHash = sha256(JSON.stringify(req.body));
    if (requestHash !== cached.requestHash) {
      return res.status(422).json({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    }
    return res.status(cached.responseStatus).json(cached.responseBody);
  }

  // Capture response and store it
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    db.idempotencyKeys.create({
      data: { key, method: req.method, path: normalizedPath(req.path),
              responseStatus: res.statusCode, responseBody: body,
              requestHash: sha256(JSON.stringify(req.body)),
              expiresAt: new Date(Date.now() + 86_400_000) }
    }).catch(console.error);  // non-blocking
    return originalJson(body);
  };
  next();
}
```

### 12.3 Rate Limiting (Redis-backed)

Three tiers, applied in order:
```typescript
// Global: 100 req/min per IP (all unauthenticated traffic)
const globalLimiter = rateLimit({ windowMs: 60_000, max: 100, store: redisStore });

// Auth endpoints: 20 req/15min per IP
const authLimiter = rateLimit({ windowMs: 900_000, max: 20, store: redisStore });

// API key traffic: 1000 req/min per key + 50 burst/sec per key
const apiKeyLimiter = rateLimit({ windowMs: 60_000, max: 1000, keyGenerator: req => req.apiKey.id });
```

Include rate limit headers on every response:
```
X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
Retry-After (only on 429)
```

### 12.4 Audit Logging

Write to `audit_logs` table after every successful mutation:
```typescript
interface AuditEntry {
  action: string;         // 'CARD_ISSUED', 'AUTH_DECLINED', 'USER_ROLE_CHANGED', etc.
  actorId: string;
  actorEmail: string;
  resourceType: string;   // 'card', 'user', 'order', etc.
  resourceId: string;
  programId?: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, unknown>;  // before/after for mutations, parameters for reads
  requestId: string;
  createdAt: Date;
}
```

### 12.5 Security Headers

```typescript
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] } },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));
```

### 12.6 Raw Body Capture (for HMAC verification)

```typescript
app.use(express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf; }
}));
```

---

## Part 13: Notification System

### 13.1 Event → Notification Map

Consume from Kafka topic `card-events`. For each event type, determine channels:

| Event | Email | SMS | Push |
|-------|-------|-----|------|
| `card.issued` | ✓ | — | — |
| `card.activated` | ✓ | ✓ | — |
| `card.authorized` (amount > threshold) | — | ✓ | ✓ |
| `card.declined` | — | ✓ | ✓ |
| `card.balance_low` | ✓ | — | ✓ |
| `card.expiring_soon` (60 days) | ✓ | — | — |
| `card.reloaded` | ✓ | ✓ | — |
| `card.frozen` | ✓ | ✓ | — |
| `card.pin_changed` | ✓ | — | — |
| `dispute.resolved` | ✓ | — | — |
| `dormancy.fee_assessed` | ✓ | — | — |

### 13.2 Email Delivery

Use AWS SES. Implement with retry (3 attempts, exponential backoff). Mark as failed after 3 attempts and alert on-call.

All emails must include:
- `List-Unsubscribe` header with one-click unsubscribe URL
- Plain text fallback
- Unsubscribe link in footer

Transactional email template system: store MJML source in `services/api/src/templates/email/`. Compile to HTML at startup, cache in memory.

### 13.3 Webhook Outbound Delivery

All external webhooks are delivered via BullMQ job `webhook-delivery`. Retry schedule:
`[1min, 5min, 30min, 2h, 8h, 24h]` — 6 attempts then `EXHAUSTED`.

Signature header on every delivery:
```
X-GiftCard-Signature: sha256=<HMAC-SHA-256 of raw body using endpoint secret>
X-GiftCard-Timestamp: <Unix timestamp>
X-GiftCard-Event: card.authorized
```

Reject replays: if timestamp is > 5 minutes old, endpoint should (and docs should tell partners to) reject the delivery.

---

## Part 14: Admin Frontend

Build a React SPA for the admin portal at `frontends/admin/`. Use React Router v7, TanStack Query for data fetching, React Hook Form + Zod for forms.

### Pages Required

| Page | Path | Key Features |
|------|------|-------------|
| Login | `/login` | Email/password, SSO button, TOTP step |
| Dashboard | `/admin` | KPI cards (today's issuance, redemptions, float variance), 30-day volume chart, recent fraud flags |
| Cards | `/admin/cards` | Search/filter table, issue card modal, export CSV |
| Card Detail | `/admin/cards/:id` | Info panel, balance, status badge, transaction ledger, action buttons |
| Orders | `/admin/orders` | Status filter, CSV upload, approval controls |
| Programs | `/admin/programs` | Program cards with budget utilization bars |
| Program Detail | `/admin/programs/:id` | Settings, campaigns, departments, accounts panel |
| Users | `/admin/users` | User table with role badges, invite modal |
| Fraud | `/admin/fraud` | Tabs: Fraud Flags / Velocity Rules. Flags table with resolve action |
| KYC | `/admin/kyc` | Tab filter (Pending/Approved/Rejected), approve/reject buttons |
| Reports | `/admin/reports` | Left sidebar report selector, date range pickers, Export CSV/PDF |
| Settlement | `/admin/settlement` | Settlement runs, party management |
| Disputes | `/admin/disputes` | Dispute queue with assignment and resolution |
| Audit Log | `/admin/audit-log` | Category filter tabs, paginated table |
| Webhooks | `/admin/webhooks` | Endpoint list, delivery log |
| HR Integration | `/admin/hr-integration` | Event denomination config per program |
| Settings | `/admin/settings` | Profile, change password, 2FA setup, API keys |

### Frontend Architecture

- **Auth state:** stored in memory (not localStorage). Access token in memory, refresh token in `HttpOnly Secure SameSite=Strict` cookie.
- **API client:** typed wrapper around `fetch` with auto-retry on 401 (refresh then retry), request ID header injection, idempotency key generation.
- **Error handling:** global error boundary with friendly messages. Never expose raw error codes to users.
- **Loading states:** every table and data panel shows a skeleton loader.
- **Empty states:** every table shows a helpful empty state (not just "No data").
- **Pagination:** cursor-based, "Load more" pattern or paginator component.
- **Forms:** all validated client-side with Zod before submission.

---

## Part 15: Cardholder Frontend

Build a separate SPA at `frontends/cardholder/`. This is a public-facing application — no admin features, no admin auth.

| Page | Path |
|------|------|
| Balance Check | `/balance` |
| Transaction History | `/history` |
| Card Registration | `/register` |
| PIN Change | `/pin` |
| Dispute Submission | `/dispute` |
| Reload / Top-Up | `/reload` |

Design principle: extremely simple, mobile-first, accessible (WCAG 2.1 AA). Users may be non-technical and on mobile devices. Large fonts, high contrast, clear error messages.

---

## Part 16: Infrastructure

### 16.1 Environment Variables

Validate all required env vars at startup using Zod. Crash immediately with a clear error if any required var is missing. Never start the application in an inconsistent state.

```typescript
const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  DATABASE_READ_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z.string(),
  VAULT_URL: z.string().url(),
  VAULT_CLIENT_CERT: z.string(),
  VAULT_CLIENT_KEY: z.string(),
  JWT_PRIVATE_KEY: z.string(),
  JWT_PUBLIC_KEY: z.string(),
  ENCRYPTION_KEY: z.string().length(64),  // 32 bytes hex
  TOKENIZATION_KEY: z.string().length(64),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  AWS_SES_REGION: z.string(),
  S3_BUCKET: z.string(),
  FRAUD_ENGINE_URL: z.string().url(),
  OFAC_API_KEY: z.string(),
  FRONTEND_URL: z.string().url(),
  PORT: z.coerce.number().default(4000),
}).parse(process.env);
```

### 16.2 Docker Compose (Local Dev)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: giftcard, POSTGRES_USER: giftcard, POSTGRES_PASSWORD: giftcard }
    ports: ["5432:5432"]
    volumes: [postgres_data:/var/lib/postgresql/data]

  postgres-vault:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: vault, POSTGRES_USER: vault, POSTGRES_PASSWORD: vault }
    ports: ["5433:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    ports: ["9092:9092"]
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk

  api:
    build: ./services/api
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgresql://giftcard:giftcard@postgres:5432/giftcard
      REDIS_URL: redis://redis:6379
      # ... all required vars
    depends_on: [postgres, redis, kafka, vault]

  vault:
    build: ./services/vault
    ports: ["4001:4001"]
    environment:
      DATABASE_URL: postgresql://vault:vault@postgres-vault:5432/vault
    depends_on: [postgres-vault]

  fraud:
    build: ./services/fraud
    ports: ["4002:4002"]
    environment:
      REDIS_URL: redis://redis:6379
    depends_on: [redis]

  worker:
    build: ./services/api
    command: node dist/worker/scheduler.js
    environment:
      DATABASE_URL: postgresql://giftcard:giftcard@postgres:5432/giftcard
      REDIS_URL: redis://redis:6379
    depends_on: [postgres, redis, kafka]
```

### 16.3 Health Endpoints

Every service exposes:
- `GET /health/live` — liveness: returns 200 if process is running
- `GET /health/ready` — readiness: returns 200 only if DB + Redis + Kafka connections are healthy. Returns 503 if any dependency is down. Used by load balancer and Kubernetes readiness probe.

### 16.4 Metrics Endpoint

`GET /metrics` — Prometheus scrape endpoint. **This endpoint must not be exposed through the public API gateway.** It is for internal Prometheus scraping only, on a separate port or with IP allowlist.

---

## Part 17: Observability

### 17.1 Logging Rules

Every log line is JSON (Winston `json` format). Required fields on every line:
`timestamp`, `level`, `service`, `version`, `requestId`, `message`

Additional context attached via `logger.child({ userId, programId, cardId })` in middleware.

**Never log:**
- Card numbers (PANs) or any portion of a PAN beyond `last4`
- PINs or PIN hashes
- Passwords or password hashes
- Full API keys (log only the prefix)
- SSNs, tax IDs, or bank account numbers
- JWT tokens or refresh tokens

Use a custom log transport that scans for patterns matching PANs (16-digit numbers) and replaces with `[REDACTED]`.

### 17.2 Prometheus Metrics

Implement these metrics using `prom-client`:

```typescript
// Counters
const authorizationsTotal = new Counter({ name: 'gift_card_authorizations_total', labelNames: ['program', 'decision'] });
const fraudFlagsTotal = new Counter({ name: 'gift_card_fraud_flags_total', labelNames: ['program', 'severity', 'source'] });
const dormancyFeesTotal = new Counter({ name: 'gift_card_dormancy_fees_total', labelNames: ['program'] });

// Histograms
const authLatency = new Histogram({ name: 'gift_card_auth_latency_seconds',
  labelNames: ['decision'], buckets: [0.01, 0.05, 0.1, 0.15, 0.3, 0.5, 1] });
const fraudEngineLatency = new Histogram({ name: 'gift_card_fraud_engine_latency_seconds',
  buckets: [0.01, 0.025, 0.05, 0.08, 0.1, 0.2] });

// Gauges (updated by reconciliation job)
const floatVarianceCents = new Gauge({ name: 'gift_card_float_variance_cents', labelNames: ['program'] });
const totalCardBalanceCents = new Gauge({ name: 'gift_card_total_card_balances_cents', labelNames: ['program'] });
```

---

## Part 18: Testing Requirements

Every module must have:

### 18.1 Unit Tests
Test business logic in isolation with mocked dependencies:
- All ledger entry templates (verify debit/credit balance)
- CARD Act fee constraints (fee cannot exceed balance, cannot charge before 12 months)
- Idempotency key handling (duplicate request returns cached response)
- Refresh token rotation and theft detection
- Fraud scoring logic (test each layer independently)
- Balance computation with checkpoint + incremental

### 18.2 Integration Tests
Test against a real PostgreSQL instance (Vitest + `pg` setup/teardown):
- Full authorization → capture → reversal flow
- Full card issuance → dormancy → escheatment flow
- Concurrent authorizations on the same card (verify no double-spend)
- Settlement run calculation
- Reconciliation job detects and flags variance

### 18.3 API Tests
Use Bruno (or Supertest) for full HTTP request/response testing:
- Happy path for every endpoint
- Auth boundary tests (forbidden, unauthenticated, wrong program)
- Rate limit behavior
- Idempotency key replay
- Validation errors (missing fields, wrong types, out-of-range amounts)

---

## Part 19: Security Hardening Checklist

Before any code is considered complete, verify:

- [ ] No `console.log` anywhere — all logging through Winston
- [ ] No raw `process.env` access outside `env.ts` Zod validation
- [ ] `trust proxy 1` set on Express (for correct IP behind nginx/load balancer)
- [ ] All SQL uses parameterized queries (Prisma enforces this)
- [ ] No dynamic SQL construction from user input anywhere
- [ ] SSRF protection on all webhook URL inputs: validate `https://` only, block private IP ranges, block `localhost`
- [ ] All file uploads: validate MIME type and extension, scan for null bytes in filename, limit size to 10MB
- [ ] CSV processing: parse field-by-field, reject files with formula injection characters (`=`, `+`, `-`, `@` at start of field)
- [ ] All auth routes under `authLimiter`, balance check under `balanceLimiter`
- [ ] `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` headers on all responses
- [ ] PAN redaction log filter active and tested
- [ ] Invite tokens are single-use and expire after 72 hours
- [ ] Password reset tokens are single-use and expire after 15 minutes
- [ ] Audit log written for every auth event, every card mutation, every admin action
- [ ] Metrics endpoint not accessible through public API gateway
- [ ] All error responses use generic messages on auth endpoints (no account existence leakage)
- [ ] Refresh token family revocation on reuse detection

---

## Part 20: Build Order

Build in this sequence. Do not move to the next phase until the current phase has passing tests.

### Phase 1: Core Infrastructure (build this first)
1. Repository setup with TypeScript strict mode, ESLint, Prettier
2. PostgreSQL schema (all tables) + Prisma schema
3. Redis and Kafka clients (typed wrappers)
4. Environment variable validation
5. Shared middleware (request ID, logging, security headers, raw body)
6. Health endpoints on all services

### Phase 2: Ledger Engine
1. `postEntry` function with balance constraint validation
2. `getBalance` with checkpoint + incremental algorithm
3. Balance checkpoint writer job
4. Float reconciliation job
5. All entry template functions (postLoad, postAuth, postCapture, etc.)
6. **Test:** verify every entry template produces balanced entries

### Phase 3: Tokenization Vault
1. Vault service with own DB
2. Token generation (deterministic HMAC)
3. AES-256-GCM encryption/decryption
4. `POST /tokens`, `GET /tokens/:token`, `POST /reveal`, `DELETE /tokens/:token`
5. mTLS client cert authentication
6. Reveal audit log

### Phase 4: IAM & Auth
1. User model, password hashing, invite flow
2. Login with all gates (email verified, account status, lockout, TOTP)
3. JWT issuance (RS256) + refresh token rotation + theft detection
4. RBAC middleware
5. API key management
6. All `/auth` endpoints

### Phase 5: Card Lifecycle
1. Card issuance (postLoad journal entry, vault token, PIN hash)
2. Card status transitions (activate, suspend, cancel)
3. CARD Act expiry enforcement (minimum 5 years)
4. Cardholder portal auth (card + PIN)

### Phase 6: Authorization/Capture
1. Auth endpoint with all pipeline steps
2. Advisory locking for concurrent auth prevention
3. Capture, void, reversal endpoints
4. Expired auth sweeper job
5. Fraud engine service (all four layers)

### Phase 7: Compliance Engine
1. Dormancy fee assessment job
2. OFAC screening integration
3. Escheatment scanner and NAUPA file generation
4. KYC check workflow
5. CTR/SAR flagging

### Phase 8: Bulk Issuance & Orders
1. Order creation (JSON + CSV upload)
2. BullMQ card issuance worker (process asynchronously, rate limit at ~100 cards/sec)
3. Order approval workflow
4. Order status tracking + line items

### Phase 9: Settlement & GL
1. Settlement party management
2. Settlement run job
3. Settlement line item calculation
4. GL mapping configuration
5. GL export (CSV for NetSuite; extend for SAP/Oracle later)

### Phase 10: Cardholder Features
1. Cardholder portal API (balance, history, PIN change, registration)
2. Reload / top-up (Stripe PaymentIntent + webhook)
3. Auto-reload configuration
4. Dispute submission and management workflow
5. Digital wallet provisioning stub (document integration point)

### Phase 11: Reporting & Integrations
1. Six standard reports (liability, breakage, escheatment, reconciliation, fraud, settlement)
2. Webhook outbound delivery with BullMQ retry
3. HR event integration webhook
4. Notification service (email via SES, webhook events)

### Phase 12: Admin Frontend
Build pages in this order:
1. Login + auth flow
2. Dashboard
3. Cards list + card detail
4. Orders
5. Programs + program detail
6. Users + invite flow
7. Fraud + KYC
8. Reports
9. Settlement
10. Disputes
11. Audit log
12. Webhooks + HR integration
13. Settings (profile, 2FA, API keys)

### Phase 13: Cardholder Frontend
All cardholder portal pages.

### Phase 14: Hardening
1. Full test suite (unit + integration + API)
2. Load test: sustain 1,000 authorizations/minute for 10 minutes
3. Penetration test checklist (OWASP Top 10)
4. Security header audit
5. PAN redaction log audit
6. Full reconciliation accuracy validation

---

## Critical Reminders

Read these before writing any code that touches money:

1. **`BIGINT` only for amounts.** If you see `number` or `Number` being used for an amount anywhere in financial logic, it is a bug.

2. **Never update a posted journal entry.** If a correction is needed, post a reversal and a new entry.

3. **Always check idempotency first.** The idempotency check is step 1, before any DB reads, on every mutating endpoint.

4. **Balance is derived, never trusted from a column.** Even if you add a `balance` field to the `cards` table as a cache, always recompute from the ledger when the answer matters (authorization decisions, reconciliation).

5. **Card numbers are never stored in the application database.** Only tokens from the vault. This is a PCI requirement and a security absolute.

6. **The reconciliation job is your canary.** If `float_balance ≠ SUM(card_balances) + pending_holds`, something is wrong with your ledger code. Fix it before it happens in production by writing this test first.

7. **Audit every financial action.** Every call to `postEntry` must result in an audit log entry. If you cannot explain why a balance changed by looking at the audit log, the platform is not fit for production.

8. **Compliance is non-negotiable.** The CARD Act is federal law. The dormancy fee and expiry rules are not product features that can be toggled — they are legal requirements.
