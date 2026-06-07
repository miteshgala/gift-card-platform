# Production-Grade Gift Card & Stored Value Platform — Full Architecture

> **Document scope:** Ground-up architectural design for a production-grade gift card and stored value platform. This document supersedes the existing implementation where the designs conflict. Every section is prescriptive: it describes what to build, why, and the exact data shapes and contracts required.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Service Topology](#2-service-topology)
3. [PCI DSS Scope Reduction Strategy](#3-pci-dss-scope-reduction-strategy)
4. [Core Data Model](#4-core-data-model)
5. [Double-Entry Ledger Design](#5-double-entry-ledger-design)
6. [Authorization / Capture / Reversal Flow](#6-authorization--capture--reversal-flow)
7. [Tokenization Vault](#7-tokenization-vault)
8. [Identity & Access Management](#8-identity--access-management)
9. [Fraud Decisioning Engine](#9-fraud-decisioning-engine)
10. [Compliance Engine](#10-compliance-engine)
11. [Float & Reconciliation Architecture](#11-float--reconciliation-architecture)
12. [Cross-Entity Settlement](#12-cross-entity-settlement)
13. [Cardholder-Facing Features](#13-cardholder-facing-features)
14. [Notification Architecture](#14-notification-architecture)
15. [Reporting, Analytics & Data Warehouse](#15-reporting-analytics--data-warehouse)
16. [Integration Layer](#16-integration-layer)
17. [API Design Standards](#17-api-design-standards)
18. [Infrastructure & Deployment](#18-infrastructure--deployment)
19. [Observability](#19-observability)
20. [Migration Roadmap](#20-migration-roadmap)

---

## 1. Guiding Principles

### 1.1 Immutability First

Every financial record is append-only. No `UPDATE` ever changes an amount, account reference, or timestamp on a posted entry. Corrections are made by posting equal-and-opposite reversals. This is the single most important architectural decision — it makes the ledger auditable, replayable, and tamper-evident.

### 1.2 Balance Is Always Derived

Card balance, float balance, liability reserve, and fee income are never stored as mutable columns. They are always `SELECT SUM(amount) FROM journal_lines WHERE account_id = ? AND entry_status = 'POSTED'`. Derived balance queries are fast because `account_id` is indexed and entries are append-only (no row churn). Materialized balance snapshots (checkpoints) are a read-side optimization only — they never become the source of truth.

### 1.3 PCI Scope Minimization

The application database never stores a raw Primary Account Number (PAN). Every card number is tokenized immediately upon generation. The tokenization vault is a separate process with its own database, its own encryption keys, and its own network segment. This reduces PCI scope to the vault alone — the main application handles only tokens, which are not cardholder data under PCI DSS 4.0.

### 1.4 Every Mutation Is Idempotent

Every state-changing API call accepts a client-supplied `Idempotency-Key` header (UUID v4). The server stores the key, method, path, and response for 24 hours. A duplicate request with the same key returns the original response without re-executing. This makes retries safe across network failures, mobile app re-sends, and queue redelivery.

### 1.5 Eventual Consistency Is Explicit

The platform has a mix of synchronous (authorization decisions) and asynchronous (settlement, escheatment, reporting) operations. Each is clearly classified, and the API contract states which category every endpoint falls into. Callers are never left guessing whether a 202 Accepted means "done" or "queued."

### 1.6 Compliance Is Not Optional

CARD Act, AML/BSA, OFAC, state escheatment, and PCI DSS are treated as first-class system requirements, not bolt-ons. The compliance engine is a core service, not a cron job. Fee assessment, dormancy tracking, and abandoned property filing are automated with auditable trails.

### 1.7 Modular Monolith, Selective Extraction

The application launches as a single deployable (modular monolith) organized by bounded context. Modules that have distinct scaling, security, or compliance profiles are extracted into independent processes as operational need arises. The tokenization vault and fraud engine are extracted from day one because of PCI and latency requirements. Everything else starts in one deployable and is extracted when profiling shows it is necessary.

---

## 2. Service Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Public Internet                                  │
└───────────┬─────────────────────────────────┬───────────────────────────┘
            │                                 │
    ┌───────▼───────┐                 ┌───────▼───────┐
    │  API Gateway  │                 │   CDN / Edge  │
    │  (nginx/Kong) │                 │  (static SPA) │
    │  TLS term.    │                 └───────────────┘
    │  rate limit   │
    │  IP allowlist │
    └───────┬───────┘
            │  (internal mTLS)
┌───────────▼──────────────────────────────────────────────────────────┐
│                        Core Platform (Modular Monolith)               │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Auth Module │  │ Card Module  │  │Ledger Module │               │
│  │  IAM / RBAC  │  │ Lifecycle    │  │Double-Entry  │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ Program Mgmt │  │ Order / Bulk │  │ Compliance   │               │
│  │ Campaigns    │  │ Issuance     │  │ CARD Act/AML │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Settlement  │  │  Reporting   │  │  Webhooks /  │               │
│  │  & Recon     │  │  & Export    │  │  Notif.      │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
└──────────────────────────┬──────────────┬──────────────┬─────────────┘
                           │              │              │
              ┌────────────▼───┐  ┌───────▼──────┐  ┌──▼─────────────┐
              │ Tokenization   │  │   Fraud      │  │  Event Bus     │
              │ Vault Service  │  │  Decisioning │  │  (Kafka)       │
              │ (PCI-isolated) │  │  Engine      │  │                │
              └────────────────┘  └──────────────┘  └───────┬────────┘
                                                             │
                                              ┌──────────────▼──────────┐
                                              │  Downstream Consumers   │
                                              │  - Data Warehouse ETL   │
                                              │  - Escheatment Engine   │
                                              │  - GL/ERP Exporter      │
                                              │  - Email/SMS Dispatcher │
                                              └─────────────────────────┘

Infrastructure:
  PostgreSQL 16 (primary + 2 read replicas, streaming replication)
  Redis 7 Cluster (sessions, idempotency cache, rate limits, locks)
  Kafka 3.x (event streaming, audit trail, async pipelines)
  S3-compatible object store (CSV exports, escheatment filings, audit archives)
  HashiCorp Vault (encryption keys, secrets, audit log)
  Prometheus + Grafana + Loki (metrics, dashboards, log aggregation)
```

### 2.1 Why Not Full Microservices from Day One

Full microservices require distributed tracing, service mesh, independent deployment pipelines, and cross-service transaction coordination (sagas) for every operation. The operational overhead dwarfs the benefit until the team exceeds ~30 engineers or a module needs independent scaling. The modular monolith gives clean module boundaries enforced by TypeScript barrel imports and ESLint `no-restricted-imports` rules, without the distributed systems tax. Each module has its own directory, its own Prisma models (logically), and owns its own database tables. Extraction to a separate service is a structural move, not a rewrite.

**Extracted from day one (hard requirements):**
- **Tokenization Vault** — PCI DSS requires it to be isolated. Different HSM keys, network segment, access controls.
- **Fraud Decisioning Engine** — Must respond in <50ms per authorization. Separate process with an in-memory rule cache prevents main-app latency from affecting fraud decisions.

---

## 3. PCI DSS Scope Reduction Strategy

### 3.1 Tokenization Vault Architecture

The vault is the only component in PCI scope. Everything else is out of scope by design.

```
Card Generation Flow:
  1. Core platform calls POST /vault/tokens  { pan: "4111..." }
  2. Vault stores PAN encrypted with AES-256-GCM under an HSM-managed key
  3. Vault returns { token: "tok_live_abc123xyz", last4: "1111", bin: "411111" }
  4. Core platform stores ONLY the token — never the PAN
  5. Core platform generates a separate PIN hash (bcrypt, cost 12) stored locally

Card Number Reveal Flow (cardholder self-service only):
  1. Cardholder authenticates (session + OTP second factor)
  2. Core platform calls POST /vault/reveal { token, requester_id, reason }
  3. Vault logs the reveal request to immutable audit store
  4. Vault returns { pan: "4111..." } over mTLS
  5. Core platform passes PAN directly to response — never logs it
  6. Response header: Cache-Control: no-store, Pragma: no-cache
```

### 3.2 Vault API Surface (Internal Only)

```
POST   /vault/tokens          — store a PAN, receive a token
GET    /vault/tokens/:token   — retrieve metadata (last4, bin, expiry month/year)
POST   /vault/reveal          — retrieve PAN (audit-logged, rate-limited)
DELETE /vault/tokens/:token   — purge on card close (GDPR right to erasure)
POST   /vault/migrate-key     — HSM key rotation (triggers re-encryption of all PANs)
```

### 3.3 HSM Key Hierarchy

```
Root of Trust: HSM (AWS CloudHSM or Thales Luna)
  └── Key Encryption Key (KEK) — never leaves HSM
       └── Data Encryption Key (DEK) — encrypted at rest by KEK
            └── Per-PAN ciphertext — encrypted by DEK
```

Key rotation: DEKs are rotated on a 90-day schedule. Old DEKs are retained for decryption of existing ciphertexts until all PANs under that DEK have been migrated. The `vault/migrate-key` operation re-encrypts all PANs to the new DEK in a background job, recording progress in a `key_rotation_jobs` table.

### 3.4 Network Segmentation

| Segment | Contains | Allowed inbound |
|---------|----------|-----------------|
| PCI Zone | Vault service, HSM, vault DB | Core platform on port 8443 (mTLS only) |
| App Zone | Core platform, Redis, Kafka | API Gateway on 443 |
| Data Zone | PostgreSQL, object store | App zone, DBA VPN only |
| Mgmt Zone | Prometheus, Grafana, bastion | VPN only |

---

## 4. Core Data Model

All tables are in PostgreSQL with pgcrypto for UUID generation (`gen_random_uuid()`). Timestamps are `TIMESTAMPTZ` with timezone always UTC. Monetary amounts are `BIGINT` representing minor currency units (cents for USD). **Never use FLOAT or NUMERIC for money.**

### 4.1 Accounts

```sql
CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type   TEXT NOT NULL,     -- 'CARD', 'FLOAT', 'LIABILITY_RESERVE',
                                    -- 'BREAKAGE', 'FEE_INCOME', 'ESCROW',
                                    -- 'SETTLEMENT_SUSPENSE'
  normal_balance TEXT NOT NULL,     -- 'DEBIT' or 'CREDIT' (accounting convention)
  currency       CHAR(3) NOT NULL,  -- ISO 4217
  program_id     UUID REFERENCES programs(id),
  card_id        UUID REFERENCES cards(id),  -- only for CARD accounts
  party_id       UUID REFERENCES settlement_parties(id), -- for FLOAT, SETTLEMENT
  label          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'FROZEN', 'CLOSED'
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ
);

CREATE INDEX accounts_card_id_idx       ON accounts(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX accounts_program_id_idx    ON accounts(program_id);
CREATE INDEX accounts_party_id_idx      ON accounts(party_id) WHERE party_id IS NOT NULL;
CREATE INDEX accounts_type_status_idx   ON accounts(account_type, status);
```

**Account type taxonomy:**
- `CARD` — One per issued card. Balance = what the cardholder can spend.
- `FLOAT` — Program-level float. Funded when cards are issued, debited when cards are redeemed.
- `LIABILITY_RESERVE` — Outstanding liability to cardholders (GAAP: gift card liability).
- `BREAKAGE` — Revenue recognized from unredeemed balances (ASC 606 breakage).
- `FEE_INCOME` — Dormancy fee revenue.
- `ESCROW` — Funds held for escheatment filing.
- `SETTLEMENT_SUSPENSE` — Transit account used during cross-entity settlement.

### 4.2 Journal Entries

```sql
CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type       TEXT NOT NULL,   -- 'LOAD', 'AUTH', 'CAPTURE', 'REVERSAL',
                                    -- 'VOID', 'REFUND', 'FEE', 'ADJUSTMENT',
                                    -- 'ESCHEAT', 'BREAKAGE_RECOGNITION',
                                    -- 'SETTLEMENT', 'RELOAD'
  status           TEXT NOT NULL DEFAULT 'POSTED', -- 'PENDING', 'POSTED', 'VOIDED'
  idempotency_key  TEXT UNIQUE,     -- client-supplied, stored for 24h replay
  authorization_id UUID REFERENCES authorizations(id),
  order_id         UUID REFERENCES orders(id),
  program_id       UUID NOT NULL REFERENCES programs(id),
  initiated_by     UUID REFERENCES users(id),  -- NULL for system entries
  external_ref     TEXT,            -- merchant transaction ID, POS ref, etc.
  description      TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX je_authorization_id_idx ON journal_entries(authorization_id);
CREATE INDEX je_program_id_idx       ON journal_entries(program_id);
CREATE INDEX je_entry_type_idx       ON journal_entries(entry_type);
CREATE INDEX je_posted_at_idx        ON journal_entries(posted_at DESC);
CREATE INDEX je_idempotency_key_idx  ON journal_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### 4.3 Journal Lines (the double-entry heart)

```sql
CREATE TABLE journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         UUID NOT NULL REFERENCES journal_entries(id),
  account_id       UUID NOT NULL REFERENCES accounts(id),
  direction        TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount           BIGINT NOT NULL CHECK (amount > 0),  -- always positive
  currency         CHAR(3) NOT NULL,
  sequence         SMALLINT NOT NULL,   -- ordering within the entry
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every entry must balance: SUM(debits) = SUM(credits) — enforced by constraint trigger
CREATE INDEX jl_account_id_idx       ON journal_lines(account_id);
CREATE INDEX jl_entry_id_idx         ON journal_lines(entry_id);
CREATE INDEX jl_account_created_idx  ON journal_lines(account_id, created_at DESC);
```

**Balance constraint trigger:**
```sql
CREATE OR REPLACE FUNCTION check_entry_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total_debits  BIGINT;
  total_credits BIGINT;
BEGIN
  SELECT
    SUM(amount) FILTER (WHERE direction = 'DEBIT'),
    SUM(amount) FILTER (WHERE direction = 'CREDIT')
  INTO total_debits, total_credits
  FROM journal_lines
  WHERE entry_id = NEW.entry_id;

  IF total_debits IS DISTINCT FROM total_credits THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=% credits=%',
      NEW.entry_id, total_debits, total_credits;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
```

### 4.4 Balance Checkpoints (Read-Side Optimization)

```sql
CREATE TABLE balance_checkpoints (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id),
  balance        BIGINT NOT NULL,  -- derived balance at checkpoint_at
  currency       CHAR(3) NOT NULL,
  checkpoint_at  TIMESTAMPTZ NOT NULL,
  last_entry_id  UUID NOT NULL REFERENCES journal_entries(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (account_id, checkpoint_at)
);

CREATE INDEX bc_account_id_checkpoint_idx ON balance_checkpoints(account_id, checkpoint_at DESC);
```

Balance computation algorithm:
1. Find the most recent checkpoint for `account_id` where `checkpoint_at <= NOW()`.
2. Sum all `journal_lines` for the account where `journal_entries.posted_at > checkpoint.checkpoint_at` and `journal_entries.status = 'POSTED'`.
3. Apply sign based on `normal_balance` and `direction` — for a CREDIT-normal account (CARD), credits increase balance, debits decrease it.
4. Return `checkpoint.balance + incremental_sum`.

Checkpoints are written by a background job every hour (or every 10,000 lines for high-volume accounts). A checkpoint is never trusted unless `last_entry_id` still matches the most recent entry on the account at the time of read — if it doesn't, fall back to full summation. This prevents phantom reads during concurrent writes.

### 4.5 Cards

```sql
CREATE TABLE cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  campaign_id     UUID REFERENCES campaigns(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),  -- the CARD account
  vault_token     TEXT NOT NULL UNIQUE,  -- token from tokenization vault
  last4           CHAR(4) NOT NULL,
  bin             VARCHAR(8) NOT NULL,
  card_type       TEXT NOT NULL,    -- 'PHYSICAL', 'VIRTUAL', 'SINGLE_USE'
  status          TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
  -- PENDING_ACTIVATION, ACTIVE, SUSPENDED, EXPIRED, CANCELLED, ESHEATED
  currency        CHAR(3) NOT NULL,
  initial_load    BIGINT NOT NULL,  -- in minor units
  expires_at      TIMESTAMPTZ NOT NULL,  -- CARD Act: minimum 5 years from issue
  activated_at    TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  kyc_status      TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  -- NOT_REQUIRED, PENDING, APPROVED, REJECTED, EXPIRED
  recipient_name  TEXT,
  recipient_email TEXT,
  -- PIN: stored as bcrypt hash in the card_pins table (separate, access-controlled)
  department_id   UUID REFERENCES departments(id),
  issued_by       UUID REFERENCES users(id),
  order_id        UUID REFERENCES orders(id),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cards_program_id_idx    ON cards(program_id);
CREATE INDEX cards_status_idx        ON cards(status);
CREATE INDEX cards_expires_at_idx    ON cards(expires_at);
CREATE INDEX cards_last_used_at_idx  ON cards(last_used_at);
CREATE INDEX cards_vault_token_idx   ON cards(vault_token);

-- PIN stored separately with tighter access controls
CREATE TABLE card_pins (
  card_id       UUID PRIMARY KEY REFERENCES cards(id),
  pin_hash      TEXT NOT NULL,      -- bcrypt cost 12
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  locked_at     TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.6 Authorizations

```sql
CREATE TABLE authorizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  program_id      UUID NOT NULL REFERENCES programs(id),
  status          TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING, CAPTURED, PARTIALLY_CAPTURED, REVERSED, VOIDED, EXPIRED
  requested_amount BIGINT NOT NULL,
  authorized_amount BIGINT NOT NULL,   -- may differ (partial auth)
  captured_amount  BIGINT NOT NULL DEFAULT 0,
  reversed_amount  BIGINT NOT NULL DEFAULT 0,
  currency         CHAR(3) NOT NULL,
  merchant_token   TEXT,              -- vault token for the merchant PAN (open-loop)
  merchant_name    TEXT,
  merchant_mcc     CHAR(4),           -- ISO 18245 MCC
  merchant_country CHAR(2),
  pos_entry_mode   TEXT,              -- 'CHIP', 'SWIPE', 'CONTACTLESS', 'ECOM', 'MANUAL'
  retrieval_ref    TEXT,              -- ISO 8583 retrieval reference number
  auth_code        TEXT,              -- 6-char approval code sent to POS
  fraud_score      SMALLINT,          -- 0-100 from fraud engine
  fraud_decision   TEXT,             -- 'APPROVE', 'DECLINE', 'REVIEW'
  idempotency_key  TEXT UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  authorized_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_at      TIMESTAMPTZ,
  voided_at        TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX auth_card_id_idx       ON authorizations(card_id);
CREATE INDEX auth_status_idx        ON authorizations(status);
CREATE INDEX auth_expires_at_idx    ON authorizations(expires_at)
  WHERE status = 'PENDING';
CREATE INDEX auth_retrieval_ref_idx ON authorizations(retrieval_ref)
  WHERE retrieval_ref IS NOT NULL;
```

### 4.7 Programs

```sql
CREATE TABLE programs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT,
  currency             CHAR(3) NOT NULL DEFAULT 'USD',
  open_loop            BOOLEAN NOT NULL DEFAULT FALSE,
  card_expiry_days     INTEGER NOT NULL DEFAULT 1825, -- 5 years (CARD Act minimum)
  dormancy_fee_cents   BIGINT NOT NULL DEFAULT 0,
  dormancy_months      INTEGER NOT NULL DEFAULT 12, -- CARD Act: 12 months before fee allowed
  max_dormancy_fee_cents BIGINT NOT NULL DEFAULT 0,
  budget_cap           BIGINT,                        -- NULL = unlimited
  approval_threshold   BIGINT NOT NULL DEFAULT 500000,
  auto_approve_limit   BIGINT NOT NULL DEFAULT 100000,
  kyc_required_above   BIGINT,  -- NULL = never required
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  float_account_id     UUID REFERENCES accounts(id),    -- the program FLOAT account
  liability_account_id UUID REFERENCES accounts(id),    -- LIABILITY_RESERVE account
  breakage_account_id  UUID REFERENCES accounts(id),    -- BREAKAGE account
  fee_account_id       UUID REFERENCES accounts(id),    -- FEE_INCOME account
  escrow_account_id    UUID REFERENCES accounts(id),    -- ESCROW account
  owner_party_id       UUID REFERENCES settlement_parties(id),
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.8 Compliance Tables

```sql
-- CARD Act dormancy tracking
CREATE TABLE dormancy_assessments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id       UUID NOT NULL REFERENCES cards(id),
  program_id    UUID NOT NULL REFERENCES programs(id),
  dormant_since TIMESTAMPTZ NOT NULL,
  fee_amount    BIGINT NOT NULL,     -- cents
  currency      CHAR(3) NOT NULL,
  months_dormant INTEGER NOT NULL,
  entry_id      UUID REFERENCES journal_entries(id),  -- the FEE journal entry
  assessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  waived        BOOLEAN NOT NULL DEFAULT FALSE,
  waived_reason TEXT
);

-- State escheatment tracking
CREATE TABLE escheatment_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  program_id      UUID NOT NULL REFERENCES programs(id),
  state_code      CHAR(2) NOT NULL,   -- US state
  holder_state    CHAR(2),            -- cardholder's last known state
  property_type   TEXT NOT NULL,      -- 'GC01' (NAUPA gift card code)
  amount          BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  dormant_since   TIMESTAMPTZ NOT NULL,
  eligible_at     TIMESTAMPTZ NOT NULL,   -- when it becomes reportable
  status          TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING, REPORTED, REMITTED, RECLAIMED
  filing_id       UUID REFERENCES escheatment_filings(id),
  entry_id        UUID REFERENCES journal_entries(id),
  reported_at     TIMESTAMPTZ,
  remitted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE escheatment_filings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   UUID NOT NULL REFERENCES programs(id),
  state_code   CHAR(2) NOT NULL,
  report_year  SMALLINT NOT NULL,
  report_period TEXT NOT NULL,     -- 'H1', 'H2', or 'ANNUAL'
  naupa_file_s3_key TEXT,          -- NAUPA HRS9 format upload
  total_amount BIGINT NOT NULL,
  record_count INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT',
  -- DRAFT, SUBMITTED, ACCEPTED, REJECTED
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AML/KYC
CREATE TABLE kyc_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  check_type      TEXT NOT NULL,   -- 'IDENTITY', 'OFAC', 'ENHANCED_DUE_DILIGENCE'
  provider        TEXT NOT NULL,   -- 'PERSONA', 'ALLOY', 'LEXISNEXIS', 'INTERNAL'
  status          TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING, APPROVED, REJECTED, REQUIRES_REVIEW, EXPIRED
  reference_id    TEXT,            -- provider's reference
  risk_score      SMALLINT,
  reason_codes    TEXT[],
  raw_response    JSONB,           -- encrypted at rest
  reviewed_by     UUID REFERENCES users(id),
  review_notes    TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SAR / CTR filings (FinCEN)
CREATE TABLE sar_filings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  card_id         UUID REFERENCES cards(id),
  filing_type     TEXT NOT NULL,  -- 'SAR', 'CTR'
  trigger_event   TEXT NOT NULL,
  amount          BIGINT,
  currency        CHAR(3),
  fincen_ref      TEXT,           -- FinCEN assigned reference
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  filed_at        TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.9 Fraud Tables

```sql
CREATE TABLE fraud_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID REFERENCES cards(id),
  authorization_id UUID REFERENCES authorizations(id),
  program_id      UUID NOT NULL REFERENCES programs(id),
  source          TEXT NOT NULL,   -- 'VELOCITY_RULE', 'ML_MODEL', 'MANUAL', 'OFAC'
  severity        TEXT NOT NULL,   -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  rule_id         UUID REFERENCES velocity_rules(id),
  reason_code     TEXT NOT NULL,
  reason_text     TEXT NOT NULL,
  score           SMALLINT,        -- 0-100
  status          TEXT NOT NULL DEFAULT 'OPEN',  -- 'OPEN', 'RESOLVED', 'FALSE_POSITIVE'
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE velocity_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID REFERENCES programs(id),  -- NULL = global
  name            TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  scope           TEXT NOT NULL,  -- 'CARD', 'BIN', 'MERCHANT', 'IP', 'DEVICE'
  window_seconds  INTEGER NOT NULL,
  max_count       INTEGER,        -- max transactions in window
  max_amount      BIGINT,         -- max cumulative spend in window
  action          TEXT NOT NULL DEFAULT 'FLAG', -- 'FLAG', 'DECLINE', 'SUSPEND'
  priority        SMALLINT NOT NULL DEFAULT 50,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE device_fingerprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  fingerprint_hash TEXT NOT NULL,   -- SHA-256 of device signals
  ip_address      INET NOT NULL,
  user_agent      TEXT,
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  risk_signals    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX df_card_id_idx          ON device_fingerprints(card_id);
CREATE INDEX df_fingerprint_hash_idx ON device_fingerprints(fingerprint_hash);
CREATE INDEX df_ip_address_idx       ON device_fingerprints(ip_address);
```

### 4.10 Settlement Tables

```sql
CREATE TABLE settlement_parties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type      TEXT NOT NULL,
  -- 'FRANCHISEE', 'COALITION_BRAND', 'MARKETPLACE_SELLER',
  -- 'DISTRIBUTOR', 'WHITE_LABEL_CLIENT', 'PROGRAM_OWNER'
  name            TEXT NOT NULL,
  legal_name      TEXT NOT NULL,
  tax_id          TEXT,            -- encrypted at rest
  settlement_currency CHAR(3) NOT NULL DEFAULT 'USD',
  settlement_frequency TEXT NOT NULL DEFAULT 'WEEKLY',
  -- 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'
  bank_account_token TEXT,         -- vault token for bank routing/account
  float_account_id   UUID REFERENCES accounts(id),
  suspense_account_id UUID REFERENCES accounts(id),
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  parent_party_id UUID REFERENCES settlement_parties(id),  -- hierarchy support
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE redemption_party_links (
  authorization_id UUID NOT NULL REFERENCES authorizations(id),
  party_id         UUID NOT NULL REFERENCES settlement_parties(id),
  merchant_token   TEXT NOT NULL,  -- the vault token identifying the redemption location
  split_percent    NUMERIC(5,2),   -- for coalition splits
  PRIMARY KEY (authorization_id, party_id)
);

CREATE TABLE settlement_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  party_id        UUID NOT NULL REFERENCES settlement_parties(id),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING, CALCULATING, READY, APPROVED, PAID, FAILED
  gross_redemptions BIGINT NOT NULL DEFAULT 0,
  fees_withheld    BIGINT NOT NULL DEFAULT 0,
  net_payable      BIGINT NOT NULL DEFAULT 0,
  currency         CHAR(3) NOT NULL,
  approved_by      UUID REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  payment_ref      TEXT,           -- bank wire / ACH reference
  paid_at          TIMESTAMPTZ,
  entry_id         UUID REFERENCES journal_entries(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settlement_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES settlement_runs(id),
  authorization_id UUID NOT NULL REFERENCES authorizations(id),
  amount           BIGINT NOT NULL,
  currency         CHAR(3) NOT NULL,
  line_type        TEXT NOT NULL,  -- 'REDEMPTION', 'FEE', 'ADJUSTMENT', 'REVERSAL'
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.11 Idempotency Keys

```sql
CREATE TABLE idempotency_keys (
  key              TEXT NOT NULL,
  method           TEXT NOT NULL,      -- HTTP method
  path             TEXT NOT NULL,      -- normalized path without IDs
  response_status  SMALLINT NOT NULL,
  response_body    JSONB NOT NULL,
  request_hash     TEXT NOT NULL,      -- SHA-256 of request body
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  PRIMARY KEY (key, method, path)
);

CREATE INDEX ik_expires_at_idx ON idempotency_keys(expires_at);
-- Cleaned by a scheduled job every hour
```

---

## 5. Double-Entry Ledger Design

### 5.1 Account Chart

Every program is bootstrapped with five accounts:

| Account | Type | Normal Balance | Meaning |
|---------|------|---------------|---------|
| Program Float | FLOAT | DEBIT | Cash the program holds to back outstanding cards |
| Card Liability Reserve | LIABILITY_RESERVE | CREDIT | Outstanding obligation to cardholders (GAAP liability) |
| Breakage Income | BREAKAGE | CREDIT | Recognized revenue from unredeemed balances |
| Fee Income | FEE_INCOME | CREDIT | Revenue from dormancy fees |
| Escrow | ESCROW | CREDIT | Funds held pending state escheatment transfer |

Each issued card has one `CARD` account (normal balance: CREDIT).

### 5.2 Entry Templates

**LOAD — Card is issued / funded:**
```
DR  Program Float              +$50.00   (cash leaves program's bank, enters platform)
CR  Card Liability Reserve     +$50.00   (platform owes $50 to cardholder)
DR  Card Liability Reserve     +$50.00   (liability allocated to specific card)
CR  Card Account [card_id]     +$50.00   (card now has $50 balance)
```
Simplified to the net effect (using contra accounts):
```
DR  Program Float Account      50_00
CR  Card Account [card_id]     50_00
```

**AUTHORIZE — Card swipe creates a hold:**
```
DR  Card Account [card_id]      25_00   (reduces available balance)
CR  Authorization Suspense      25_00   (holds the funds pending capture)
```
Authorization suspense is an internal transit account per card, not a long-lived liability.

**CAPTURE — Merchant settles:**
```
DR  Authorization Suspense      25_00   (release the hold)
CR  Program Float Account       25_00   (program pays the merchant via settlement)
```

**REVERSAL — Full or partial reversal of a capture:**
```
DR  Program Float Account       25_00
CR  Card Account [card_id]      25_00
```

**VOID — Authorization cancelled before capture:**
```
DR  Authorization Suspense      25_00
CR  Card Account [card_id]      25_00   (funds returned to card)
```

**DORMANCY FEE — Monthly fee after 12 months inactive:**
```
DR  Card Account [card_id]       1_50
CR  Fee Income Account           1_50
```
CARD Act constraint: Fee may only be charged if the card has been inactive for at least 12 months, and a monthly fee may not exceed the remaining balance (i.e., it cannot drive balance negative).

**BREAKAGE RECOGNITION — Estimated unredeemable portion:**
```
DR  Card Liability Reserve      10_00
CR  Breakage Income Account     10_00
```
This is a periodic accounting entry (monthly) derived from the breakage rate model. It does not touch individual card accounts.

**ESCHEATMENT — Funds transferred to state:**
```
DR  Card Account [card_id]      (remaining balance)
CR  Escrow Account              (remaining balance)
-- card is marked ESHEATED, then on filing confirmation:
DR  Escrow Account              (amount)
CR  Program Float Account       (amount)   (cash leaves the bank to state)
```

### 5.3 Balance Query

```typescript
async function getAccountBalance(accountId: string): Promise<{ balance: bigint; currency: string }> {
  // Step 1: get latest checkpoint
  const checkpoint = await db.balanceCheckpoints.findFirst({
    where: { accountId },
    orderBy: { checkpointAt: 'desc' },
  });

  // Step 2: get account normal_balance direction
  const account = await db.accounts.findUniqueOrThrow({ where: { id: accountId } });

  // Step 3: sum incremental lines since checkpoint
  const since = checkpoint?.checkpointAt ?? new Date(0);
  const lines = await db.journalLines.groupBy({
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

  const credits = lines.find(l => l.direction === 'CREDIT')?._sum.amount ?? 0n;
  const debits  = lines.find(l => l.direction === 'DEBIT')?._sum.amount  ?? 0n;

  const incremental = account.normalBalance === 'CREDIT'
    ? credits - debits
    : debits - credits;

  const base = checkpoint?.balance ?? 0n;
  return { balance: base + incremental, currency: account.currency };
}
```

### 5.4 Float Reconciliation Check

```typescript
async function reconcileFloat(programId: string): Promise<ReconciliationResult> {
  const program = await db.programs.findUniqueOrThrow({
    where: { id: programId },
    include: { floatAccount: true },
  });

  // Sum of all active card balances
  const cardAccounts = await db.accounts.findMany({
    where: { programId, accountType: 'CARD', status: 'ACTIVE' },
    select: { id: true },
  });

  let totalCardBalance = 0n;
  for (const acc of cardAccounts) {
    const { balance } = await getAccountBalance(acc.id);
    totalCardBalance += balance;
  }

  // Program float balance
  const { balance: floatBalance } = await getAccountBalance(program.floatAccount.id);

  const variance = floatBalance - totalCardBalance;
  const isBalanced = variance === 0n;

  return { floatBalance, totalCardBalance, variance, isBalanced, programId };
}
```

Reconciliation runs nightly as a scheduled job. Variances above a configurable threshold trigger a CRITICAL alert and suspend the program from issuing new cards until the variance is explained.

---

## 6. Authorization / Capture / Reversal Flow

### 6.1 State Machine

```
                     ┌──────────────────┐
                     │     PENDING      │ ← created on auth request
                     └────────┬─────────┘
           ┌──────────────────┼──────────────────┐
           │                  │                  │
      ┌────▼─────┐     ┌──────▼───────┐   ┌──────▼─────┐
      │  VOIDED  │     │  CAPTURED    │   │  EXPIRED   │
      │(no funds │     │ (full or     │   │(7 days, no │
      │ moved)   │     │  partial)    │   │ capture)   │
      └──────────┘     └──────┬───────┘   └────────────┘
                              │
                   ┌──────────┼──────────┐
                   │                     │
            ┌──────▼─────┐      ┌────────▼───────┐
            │  REVERSED  │      │PARTIALLY_CAPTURED│
            │  (refund)  │      │  (tip-adjust,  │
            └────────────┘      │   partial ship)│
                                └────────────────┘
```

### 6.2 Authorization Request (synchronous, <100ms target)

```typescript
interface AuthRequest {
  idempotencyKey: string;
  vaultToken: string;       // card token
  pin?: string;             // for PIN-authenticated transactions
  requestedAmount: bigint;
  currency: string;
  merchantName: string;
  merchantMcc: string;
  merchantCountry: string;
  posEntryMode: string;
  retrievalRef?: string;
  metadata?: Record<string, unknown>;
}

interface AuthResponse {
  authorizationId: string;
  authCode: string | null;   // null = declined
  approved: boolean;
  approvedAmount: bigint;     // may be less than requested (partial)
  declineCode?: string;       // 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'FRAUD_DECLINE', etc.
  fraudScore: number;
}
```

**Authorization processing pipeline:**

```
1. Idempotency check (Redis lookup by idempotencyKey)
2. Load card + account (optimistic read from read replica)
3. Verify card status (ACTIVE only)
4. Verify card expiry
5. Verify PIN (if present) — bcrypt compare, count attempts
6. Call Fraud Engine (gRPC, 50ms timeout, fail-open at 80ms)
7. If fraud_decision = 'DECLINE' → return decline immediately
8. Compute available balance (checkpoint + incremental)
9. Check balance >= requestedAmount (partial auth if program allows it)
10. Acquire advisory lock: SELECT FOR UPDATE on card account
11. Write journal_entry (type: 'AUTH') + 2 journal_lines (DB transaction)
12. Write authorization record
13. Release lock
14. Emit 'card.authorized' event to Kafka
15. Return authCode + authorizationId
```

Advisory locking via `SELECT FOR UPDATE` serializes concurrent authorizations on the same card. Lock is held only during the journal write (steps 10-12), not during fraud scoring or network calls. Maximum lock hold time is ~5ms. Deadlock prevention: always acquire locks in a consistent order (by `account_id` UUID lexicographic sort when multiple accounts are involved in one entry).

### 6.3 Capture

Capture can occur from:
- POS batch file (ISO 8583 incoming batch)
- Direct API call from merchant
- Acquirer clearing file (open-loop cards)

```typescript
interface CaptureRequest {
  authorizationId: string;
  captureAmount: bigint;  // must be <= authorized_amount - captured_amount
  tipAmount?: bigint;     // tip is a separate line on the authorization
  externalRef?: string;   // merchant's transaction ID
}
```

**Rules:**
- `captureAmount + tipAmount <= authorizedAmount` (enforced by DB constraint trigger)
- Multiple partial captures are allowed until `status = 'FULLY_CAPTURED'`
- A capture on an EXPIRED authorization is rejected (expired auths are voided by the scheduler)

### 6.4 Expired Authorization Sweeper

A scheduled job (every 15 minutes) finds all `PENDING` authorizations where `expires_at < NOW()` and voids them: posts a VOID journal entry (DR Authorization Suspense, CR Card Account) and marks status `EXPIRED`. This ensures available balance never permanently includes stranded holds.

---

## 7. Tokenization Vault

### 7.1 Vault Service Implementation

The vault runs as a separate Node.js process on a separate server (or ECS task) in the PCI network segment. It has its own PostgreSQL instance and its own Redis instance. The core platform communicates with the vault only over mTLS with mutual certificate authentication.

```typescript
// vault/src/index.ts
const vault = express();
vault.use(enforceClientCert); // reject any request without valid client cert

// Token storage — deterministic tokenization (same PAN always gets same token)
// using HMAC-SHA-256 with a vault-internal key:
// token = 'tok_' + env + '_' + base62(HMAC(pan, tokenization_key)).slice(0,22)
// This enables lookup by token without decrypting PANs

vault.post('/tokens', async (req, res) => {
  const { pan } = req.body;  // validated, never logged
  const token = generateToken(pan);  // deterministic HMAC-based
  const exists = await db.vaultRecords.findUnique({ where: { token } });
  if (!exists) {
    const { ciphertext, iv, keyVersion } = encryptPan(pan);
    await db.vaultRecords.create({
      data: { token, ciphertext, iv, keyVersion, last4: pan.slice(-4), bin: pan.slice(0, 6) },
    });
  }
  res.json({ token, last4: pan.slice(-4), bin: pan.slice(0, 6) });
});
```

### 7.2 Token Format

```
tok_live_A3kxP9mQz7wRjVnB2tYc    (production)
tok_test_A3kxP9mQz7wRjVnB2tYc    (sandbox — same PAN maps to same test token)
```

Token characteristics:
- Not a PAN — cannot be used for financial transactions without vault decryption
- Deterministic — same PAN always produces same token, enabling deduplication
- Environment-scoped — test tokens never accepted in production
- 22 base-62 chars of entropy — 132 bits, not guessable

### 7.3 Key Rotation

```
1. Generate new DEK via HSM
2. Write new DEK record with status='ROTATING'
3. Background job: re-encrypt all PANs from old DEK to new DEK (batch 1000/s)
4. Track progress in key_rotation_jobs table
5. When complete: mark old DEK 'RETIRED', new DEK 'ACTIVE'
6. Old DEK retained 90 days for any decrypt-only needs, then deleted from HSM
```

---

## 8. Identity & Access Management

### 8.1 User Model

```sql
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT,              -- NULL if SSO-only
  sso_provider     TEXT,              -- 'GOOGLE', 'OKTA', 'AZURE_AD', NULL
  sso_subject      TEXT,              -- provider's user ID
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  role             TEXT NOT NULL,
  -- SUPER_ADMIN, PROGRAM_ADMIN, PROGRAM_ANALYST, SUPPORT_AGENT,
  -- MERCHANT, AUDITOR, API_SERVICE
  program_id       UUID REFERENCES programs(id),  -- NULL = global
  status           TEXT NOT NULL DEFAULT 'INVITED',
  -- INVITED, ACTIVE, SUSPENDED, DEACTIVATED
  email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  totp_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret      TEXT,              -- AES-256-GCM encrypted
  last_login_at    TIMESTAMPTZ,
  last_login_ip    INET,
  failed_attempts  SMALLINT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  invite_token_hash TEXT,             -- SHA-256 of invite token
  invite_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sso_provider, sso_subject)
);
```

### 8.2 Session Architecture

**No long-lived tokens.** All access is controlled by short-lived JWTs with a strict refresh flow.

```
Access Token:  15 minutes, signed RS256 (asymmetric — public key served at /auth/jwks)
Refresh Token: 7 days, stored as bcrypt hash in refresh_tokens table, rotated on use

refresh_tokens table:
  id            UUID
  user_id       UUID REFERENCES users(id)
  token_hash    TEXT UNIQUE      -- SHA-256, not bcrypt (bcrypt too slow for lookup)
  family_id     UUID             -- for refresh token rotation detection
  replaced_by   UUID             -- chain tracking
  ip_address    INET
  user_agent    TEXT
  expires_at    TIMESTAMPTZ
  revoked_at    TIMESTAMPTZ
  created_at    TIMESTAMPTZ
```

**Refresh token rotation:** Each use of a refresh token mints a new refresh token and invalidates the old one. If an already-used refresh token is presented (stolen token reuse), the entire family is revoked and the user is logged out everywhere.

### 8.3 RBAC Permission Matrix

| Capability | SUPER_ADMIN | PROGRAM_ADMIN | PROGRAM_ANALYST | SUPPORT_AGENT | AUDITOR | API_SERVICE |
|-----------|:-----------:|:-------------:|:---------------:|:-------------:|:-------:|:-----------:|
| Issue cards | ✓ | ✓ | — | — | — | ✓ |
| View card PAN (reveal) | — | — | — | — | — | — |
| Freeze/unfreeze card | ✓ | ✓ | — | ✓ | — | ✓ |
| Adjust card balance | ✓ | ✓ | — | — | — | — |
| Approve orders | ✓ | ✓ | — | — | — | — |
| Create programs | ✓ | — | — | — | — | — |
| Manage users | ✓ | ✓ (own program) | — | — | — | — |
| View audit log | ✓ | ✓ | ✓ | — | ✓ | — |
| Manage velocity rules | ✓ | ✓ | — | — | — | — |
| Resolve fraud flags | ✓ | ✓ | — | ✓ | — | — |
| Run settlement | ✓ | — | — | — | — | — |
| Export reports | ✓ | ✓ | ✓ | — | ✓ | — |
| Manage webhooks | ✓ | ✓ | — | — | — | — |
| View analytics | ✓ | ✓ | ✓ | — | ✓ | — |
| PAN reveal (self-service cardholder only) | — | — | — | — | — | — |

PAN reveal is never available to any admin role — only to the cardholder themselves via the cardholder portal with step-up authentication.

### 8.4 API Key Design

```sql
CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  user_id         UUID REFERENCES users(id),    -- the owner
  name            TEXT NOT NULL,
  key_prefix      CHAR(12) NOT NULL,  -- e.g. 'sk_live_abc1' (shown in UI)
  key_hash        TEXT NOT NULL UNIQUE, -- SHA-256 of full key
  environment     TEXT NOT NULL,      -- 'LIVE' or 'TEST'
  scopes          TEXT[] NOT NULL,    -- ['cards:read', 'cards:write', 'orders:read', ...]
  last_used_at    TIMESTAMPTZ,
  last_used_ip    INET,
  expires_at      TIMESTAMPTZ,        -- NULL = no expiry (not recommended)
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Key format: `sk_live_<40 random base62 chars>` — prefix shown in UI, full key shown once at creation, only hash stored.

---

## 9. Fraud Decisioning Engine

### 9.1 Four-Layer Architecture

Every authorization passes through four layers in sequence. The total budget for all four layers is **80ms** — the fraud engine returns after 80ms regardless, defaulting to the most recent decisioning result.

```
Layer 1: Hard Blocks (< 1ms)
  - Card status != ACTIVE → DECLINE
  - Card expired → DECLINE
  - Program suspended → DECLINE
  - OFAC sanctions match on merchant name → DECLINE + FLAG
  - Known bad BIN (stolen card range) → DECLINE

Layer 2: Velocity Rules (< 5ms, Redis)
  - Per-card spend in last 1h, 24h, 7d
  - Per-IP transaction count in last 1h
  - Per-device fingerprint in last 1h
  - Per-merchant transaction count per card in 24h
  - Global BIN velocity (cross-card)
  Rules are loaded from DB into Redis on startup and on rule change events.
  Each rule check is a Redis ZADD/ZRANGEBYSCORE pipeline.

Layer 3: ML Scoring Model (< 30ms, gRPC to Python service)
  - Feature vector: MCC, country, amount, time-of-day, day-of-week,
    recent velocity, merchant familiarity, device familiarity,
    IP geolocation consistency, spend pattern deviation
  - Model: XGBoost gradient boosted tree (updated weekly on labeled data)
  - Returns: risk_score (0-100), contributing_features[]
  - Threshold: score >= 80 → DECLINE; 60-79 → FLAG + approve; < 60 → approve

Layer 4: Human Review Queue (async)
  - All score >= 60 authorizations enter the review queue
  - Support agents review within SLA (CRITICAL: 15min, HIGH: 2h, MEDIUM: 24h)
  - Retroactive action: if reviewer escalates, card is suspended and
    a reversal is initiated on the captured transaction
```

### 9.2 Fraud Engine API

The fraud engine is a separate Express process consuming gRPC from the main platform.

```protobuf
service FraudEngine {
  rpc ScoreAuthorization (AuthScoreRequest) returns (AuthScoreResponse);
  rpc ReportOutcome (OutcomeReport) returns (Empty);  // for model feedback
}

message AuthScoreRequest {
  string authorization_id = 1;
  string vault_token = 2;
  int64  amount = 3;
  string currency = 4;
  string merchant_mcc = 5;
  string merchant_country = 6;
  string pos_entry_mode = 7;
  string ip_address = 8;
  string device_fingerprint = 9;
  repeated RecentTransaction recent_transactions = 10;  // last 50
}

message AuthScoreResponse {
  int32  risk_score = 1;           // 0-100
  string decision = 2;             // 'APPROVE', 'DECLINE', 'REVIEW'
  string decline_code = 3;
  repeated string triggered_rules = 4;
  repeated FeatureContribution features = 5;
}
```

### 9.3 Velocity Rule Evaluation (Redis)

```typescript
async function checkVelocityRules(
  cardId: string, programId: string, amount: bigint, now: Date
): Promise<VelocityResult> {
  const rules = await rulesCache.get(programId); // loaded from Redis, refreshed on change
  const triggered: string[] = [];
  const multi = redis.multi();

  for (const rule of rules) {
    const key = `vel:${rule.scope}:${cardId}:${rule.id}`;
    const windowStart = now.getTime() / 1000 - rule.windowSeconds;

    multi.zremrangebyscore(key, '-inf', windowStart);
    multi.zrangebyscore(key, windowStart, '+inf', 'WITHSCORES');
  }

  const results = await multi.exec();

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const members = results[i * 2 + 1] as string[];
    const count = members.length / 2;
    const total = members
      .filter((_, idx) => idx % 2 === 1)
      .reduce((sum, score) => sum + BigInt(score), 0n);

    if (rule.maxCount && count >= rule.maxCount) triggered.push(rule.id);
    if (rule.maxAmount && total + amount > rule.maxAmount) triggered.push(rule.id);
  }

  return { triggered, decision: triggered.length > 0 ? 'FLAG' : 'APPROVE' };
}
```

### 9.4 Model Training Pipeline

```
Weekly schedule (Sunday 2AM UTC):
  1. Extract labeled transactions from past 90 days
     (labels: chargebacks = fraud, no-chargeback = legitimate)
  2. Feature engineering in Python (pandas)
  3. Train XGBoost model with class_weight='balanced' (fraud is rare ~0.1%)
  4. Evaluate: AUC-ROC, precision@recall=0.95, false positive rate
  5. Shadow test new model against last week's decisions
  6. If AUC-ROC improvement >= 0.005 AND FPR delta <= 0.001: promote to production
  7. Save model artifact to S3, reload fraud engine via rolling restart
  8. Log model version, AUC-ROC, threshold to model_registry table
```

---

## 10. Compliance Engine

### 10.1 CARD Act Engine

The CARD Act (Credit Card Accountability Responsibility and Disclosure Act of 2009) imposes specific rules on gift cards. The compliance engine enforces all of them.

**Rule 1: Minimum 5-Year Expiry**
Enforced at card creation:
```typescript
const minimumExpiry = new Date();
minimumExpiry.setFullYear(minimumExpiry.getFullYear() + 5);
const expiresAt = new Date(Math.max(requestedExpiry.getTime(), minimumExpiry.getTime()));
```

**Rule 2: Dormancy Fee Gate**
A dormancy fee may only be assessed if:
- The card has had no activity (load, purchase, or balance inquiry that involves a transaction) for at least 12 consecutive months.
- The fee does not exceed the card's remaining balance.
- Only one dormancy fee per month maximum.

```typescript
async function assessDormancyFees(programId: string): Promise<void> {
  const program = await db.programs.findUniqueOrThrow({ where: { id: programId } });
  if (!program.dormancyFeeCents || program.dormancyFeeCents === 0n) return;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - program.dormancyMonths); // default 12

  const dormantCards = await db.cards.findMany({
    where: {
      programId,
      status: 'ACTIVE',
      lastUsedAt: { lt: cutoff },
    },
  });

  for (const card of dormantCards) {
    const { balance } = await getAccountBalance(card.accountId);
    if (balance <= 0n) continue;

    const feeAmount = balance < program.dormancyFeeCents
      ? balance              // fee cannot exceed balance
      : program.dormancyFeeCents;

    // Check: was a fee already assessed this month?
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
    const recentFee = await db.dormancyAssessments.findFirst({
      where: { cardId: card.id, assessedAt: { gte: thisMonthStart } },
    });
    if (recentFee) continue;

    await postJournalEntry({
      type: 'FEE',
      programId,
      description: `Dormancy fee — ${program.dormancyMonths}-month inactivity`,
      lines: [
        { accountId: card.accountId, direction: 'DEBIT', amount: feeAmount },
        { accountId: program.feeAccountId, direction: 'CREDIT', amount: feeAmount },
      ],
    });

    await db.dormancyAssessments.create({
      data: { cardId: card.id, programId, dormantSince: card.lastUsedAt!, feeAmount, currency: card.currency, monthsDormant: 12 },
    });
  }
}
```

**Rule 3: Fee Disclosure**
All fees must be disclosed in the gift card purchase agreement. The `programs` table stores `dormancyFeeCents`, `maxDormancyFeeCents`, and `dormancyMonths` which are surfaced via the cardholder portal and printed on physical card packaging.

### 10.2 Escheatment Engine

Escheatment (abandoned property) law requires turning over unredeemed gift card balances to the cardholder's state after a dormancy period (typically 3-5 years, varies by state).

```typescript
const STATE_RULES: Record<string, { dormancyYears: number; propertyType: string }> = {
  CA: { dormancyYears: 3, propertyType: 'GC01' },
  NY: { dormancyYears: 3, propertyType: 'GC01' },
  TX: { dormancyYears: 3, propertyType: 'GC01' },
  DE: { dormancyYears: 5, propertyType: 'GC01' },
  // ... all 50 states + DC
};

async function identifyEscheatmentCandidates(): Promise<void> {
  for (const [stateCode, rule] of Object.entries(STATE_RULES)) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - rule.dormancyYears);

    const candidates = await db.cards.findMany({
      where: {
        status: 'ACTIVE',
        lastUsedAt: { lt: cutoff },
        recipientState: stateCode,   // cardholder's last known state
        escheatmentRecords: { none: {} },
      },
    });

    for (const card of candidates) {
      const { balance } = await getAccountBalance(card.accountId);
      if (balance <= 0n) continue;

      await db.escheatmentRecords.create({
        data: {
          cardId: card.id,
          programId: card.programId,
          stateCode,
          holderState: stateCode,
          propertyType: rule.propertyType,
          amount: balance,
          currency: card.currency,
          dormantSince: card.lastUsedAt!,
          eligibleAt: new Date(),
          status: 'PENDING',
        },
      });
    }
  }
}

// Generate NAUPA HRS9 format file for state filing
async function generateNaupaFile(filingId: string): Promise<string> {
  const filing = await db.escheatmentFilings.findUniqueOrThrow({
    where: { id: filingId },
    include: { records: { include: { card: true } } },
  });

  const lines: string[] = [];
  lines.push(`HDR ${filing.stateCode} ${filing.reportYear}...`); // NAUPA header

  for (const record of filing.records) {
    // NAUPA property record format (HRS9)
    lines.push([
      'PR',
      record.propertyType.padEnd(4),
      (record.amount / 100n).toString().padStart(12, '0'),
      record.card.recipientName?.padEnd(40) ?? ' '.repeat(40),
      // ... all required NAUPA fields
    ].join(''));
  }

  const content = lines.join('\r\n');
  const s3Key = `escheatment/${filing.stateCode}/${filing.reportYear}/${filingId}.txt`;
  await s3.putObject({ Bucket: process.env.S3_BUCKET!, Key: s3Key, Body: content });

  await db.escheatmentFilings.update({
    where: { id: filingId },
    data: { naupaFileS3Key: s3Key, status: 'SUBMITTED' },
  });

  return s3Key;
}
```

### 10.3 AML / OFAC Controls

```typescript
// OFAC screening on every card activation and every authorization
async function screenOfac(name: string, country: string): Promise<OfacResult> {
  // Call to OFAC SDN list API (or vendor: Dow Jones, LexisNexis, Refinitiv)
  const response = await ofacClient.screen({ name, country });
  return {
    isMatch: response.matchScore >= 85,  // fuzzy match threshold
    matchScore: response.matchScore,
    matchedEntity: response.entity,
    listType: response.listType,  // 'SDN', 'CONS', 'NS-ISA', etc.
  };
}

// CTR (Currency Transaction Report): any single transaction >= $10,000
async function checkCtrThreshold(amount: bigint, currency: string): Promise<void> {
  const thresholdCents = 1_000_000n; // $10,000.00
  if (currency !== 'USD' || amount < thresholdCents) return;

  await db.sarFilings.create({
    data: {
      filingType: 'CTR',
      triggerEvent: `Single transaction >= $10,000: $${amount / 100n}`,
      amount,
      currency,
      status: 'DRAFT',
    },
  });
  // Alert compliance team for filing within 15 days
  await notifyComplianceTeam('CTR_THRESHOLD_TRIGGERED', { amount });
}

// Structuring detection: multiple transactions just below $10k
async function detectStructuring(cardId: string): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const recentTransactions = await db.authorizations.aggregate({
    where: { cardId, status: { in: ['CAPTURED', 'PARTIALLY_CAPTURED'] }, authorizedAt: { gte: oneDayAgo } },
    _sum: { capturedAmount: true },
    _count: true,
  });

  const totalAmount = recentTransactions._sum.capturedAmount ?? 0n;
  const count = recentTransactions._count;

  // Multiple transactions totaling >= $10k but each below $10k is a structuring signal
  if (totalAmount >= 1_000_000n && count >= 3) {
    await flagForSar(cardId, 'POTENTIAL_STRUCTURING', totalAmount);
  }
}
```

### 10.4 Revenue Recognition (ASC 606 / IFRS 15)

Gift card revenue is recognized in two ways:
1. **Redemption-based:** Recognize revenue when the cardholder makes a purchase.
2. **Breakage (proportional):** Recognize a portion of unredeemed balances as revenue using the expected value method.

```typescript
// Monthly breakage recognition job
async function recognizeBreakage(programId: string): Promise<void> {
  const program = await db.programs.findUniqueOrThrow({ where: { id: programId } });

  // Breakage rate = historical redemption percentage
  // Typically based on trailing 24-month cohort analysis
  const breakageRate = await computeBreakageRate(programId);  // e.g., 0.15 = 15%

  // Total unredeemed liability
  const { balance: liability } = await getAccountBalance(program.liabilityAccountId);

  // Monthly recognition amount
  const monthlyRecognition = BigInt(Math.floor(Number(liability) * breakageRate / 12));

  if (monthlyRecognition <= 0n) return;

  await postJournalEntry({
    type: 'BREAKAGE_RECOGNITION',
    programId,
    description: `Monthly breakage recognition at ${(breakageRate * 100).toFixed(1)}% annual rate`,
    lines: [
      { accountId: program.liabilityAccountId, direction: 'DEBIT', amount: monthlyRecognition },
      { accountId: program.breakageAccountId, direction: 'CREDIT', amount: monthlyRecognition },
    ],
  });
}
```

---

## 11. Float & Reconciliation Architecture

### 11.1 Daily Reconciliation Job

```typescript
interface ReconReport {
  programId: string;
  asOf: Date;
  floatBalance: bigint;
  totalCardBalances: bigint;
  pendingAuthorizations: bigint;
  variance: bigint;
  status: 'BALANCED' | 'VARIANCE' | 'CRITICAL';
  varianceThreshold: bigint;
}

async function runDailyReconciliation(): Promise<ReconReport[]> {
  const programs = await db.programs.findMany({ where: { status: 'ACTIVE' } });
  const reports: ReconReport[] = [];

  for (const program of programs) {
    const floatBal = await getAccountBalance(program.floatAccountId);
    const cardAccounts = await db.accounts.findMany({
      where: { programId: program.id, accountType: 'CARD' },
    });

    let totalCardBal = 0n;
    for (const acc of cardAccounts) {
      const { balance } = await getAccountBalance(acc.id);
      totalCardBal += balance < 0n ? 0n : balance; // negative card balance = error condition
    }

    // Outstanding AUTH holds (not yet captured)
    const pendingAuths = await db.authorizations.aggregate({
      where: { programId: program.id, status: 'PENDING' },
      _sum: { authorizedAmount: true },
    });
    const pendingHolds = pendingAuths._sum.authorizedAmount ?? 0n;

    // Float should equal: total card balances + pending holds
    const expectedFloat = totalCardBal + pendingHolds;
    const variance = floatBal.balance - expectedFloat;
    const varianceThreshold = 100n; // $1.00 tolerance for rounding

    const status = variance === 0n ? 'BALANCED'
      : Math.abs(Number(variance)) <= Number(varianceThreshold) ? 'VARIANCE'
      : 'CRITICAL';

    reports.push({
      programId: program.id, asOf: new Date(),
      floatBalance: floatBal.balance, totalCardBalances: totalCardBal,
      pendingAuthorizations: pendingHolds, variance, status, varianceThreshold,
    });

    if (status === 'CRITICAL') {
      await alertOpsTeam('RECONCILIATION_CRITICAL', { programId: program.id, variance });
      await db.programs.update({
        where: { id: program.id },
        data: { status: 'SUSPENDED_RECON' },
      });
    }
  }

  return reports;
}
```

### 11.2 GL Export Architecture

```typescript
interface GlExportEntry {
  glDate: string;          // YYYY-MM-DD
  period: string;          // YYYY-MM
  accountCode: string;     // maps to client's GL chart of accounts
  description: string;
  debit: string;           // formatted decimal string, not bigint
  credit: string;
  reference: string;       // journal_entry.id
  dimensions: Record<string, string>; // cost center, program, campaign
}

// GL mapping configuration (per program)
CREATE TABLE gl_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id),
  account_type    TEXT NOT NULL,    -- 'FLOAT', 'LIABILITY_RESERVE', 'BREAKAGE', etc.
  gl_account_code TEXT NOT NULL,    -- e.g., '2010' for gift card liability
  gl_description  TEXT NOT NULL,
  erp_system      TEXT NOT NULL,    -- 'SAP', 'ORACLE', 'NETSUITE', 'QUICKBOOKS'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

GL exports are generated as:
- **SAP**: IDoc FIDCCP02 format
- **Oracle Cloud**: FBDI spreadsheet (CSV)
- **NetSuite**: SuiteScript journal entry CSV
- **Generic**: Standard CSV with configurable column mapping

Exports are generated daily (for the previous day) and placed in a program-specific S3 prefix. Optionally pushed via SFTP to the client's ERP.

---

## 12. Cross-Entity Settlement

### 12.1 Settlement Flow

```
Redemption occurs at Merchant A (franchisee of Brand X):
  1. Authorization captured → journal entry posted
  2. authorization.settlement_party_id = merchant_A.id
  3. settlement_lines record created (pending current settlement run)

Weekly settlement run (Sunday midnight):
  1. Aggregate all captured authorizations per party since last run
  2. Deduct fees (program fee %, interchange, processing)
  3. Create settlement_run record (status: CALCULATING → READY)
  4. Notify program admin for approval
  5. Program admin approves → status: APPROVED
  6. ACH / wire instruction generated → status: PAID
  7. Journal entry:
     DR  Settlement Suspense Account   (net payable)
     CR  Program Float Account         (program receives)
     + separately: wire transfer from program's bank to merchant's bank
```

### 12.2 Multi-Level Settlement (Franchisor / Franchisee)

When a brand has both a franchisor and franchisees, the settlement hierarchy is:

```
Cardholder redeems at franchisee location
  → Franchisee receives redemption credit
  → Franchisor receives royalty fee (split_percent configuration)
  → Net settled independently to each party's bank account
```

This is configured via `settlement_parties.parent_party_id` and `redemption_party_links.split_percent`.

---

## 13. Cardholder-Facing Features

### 13.1 Cardholder Portal

A separate, public-facing web application (or white-labeled SDK) providing:

| Feature | Implementation |
|---------|---------------|
| Balance check | Derive from ledger in real-time |
| Transaction history | Paginated query on journal_entries + journal_lines |
| Card registration | Link card to email/phone for notifications |
| PIN change | POST /cardholder/pin/change with old PIN verify |
| PIN reveal (masked) | Step-up auth → vault reveal |
| Card freeze (self-service) | PATCH /cardholder/cards/:id/freeze |
| Reload / top-up | Stripe/Adyen PaymentIntent → LOAD journal entry |
| Auto-reload | Stored Stripe PaymentMethod → threshold-triggered |
| Digital wallet push | Apple Pay / Google Pay provisioning API |
| Dispute submission | Create dispute record → triggers chargeback workflow |

### 13.2 PIN Management

```typescript
// PIN change — requires current PIN verification
async function changePin(cardId: string, currentPin: string, newPin: string): Promise<void> {
  const pinRecord = await db.cardPins.findUnique({ where: { cardId } });
  if (!pinRecord) throw new AppError(404, 'PIN_NOT_SET');
  if (pinRecord.lockedAt && pinRecord.lockedAt > new Date()) {
    throw new AppError(423, 'PIN_LOCKED', 'PIN is temporarily locked');
  }

  const isValid = await bcrypt.compare(currentPin, pinRecord.pinHash);
  if (!isValid) {
    const attempts = pinRecord.attemptCount + 1;
    await db.cardPins.update({
      where: { cardId },
      data: {
        attemptCount: attempts,
        lockedAt: attempts >= 3 ? new Date(Date.now() + 30 * 60 * 1000) : null,
      },
    });
    throw new AppError(401, 'INVALID_PIN', `Invalid PIN. ${3 - attempts} attempts remaining.`);
  }

  // Validate new PIN
  if (!/^\d{4,6}$/.test(newPin)) throw new AppError(400, 'INVALID_PIN_FORMAT');
  if (newPin === currentPin) throw new AppError(400, 'PIN_SAME_AS_CURRENT');

  await db.cardPins.update({
    where: { cardId },
    data: { pinHash: await bcrypt.hash(newPin, 12), attemptCount: 0, lockedAt: null, lastChangedAt: new Date() },
  });
}
```

### 13.3 Cardholder Dispute / Chargeback Workflow

```sql
CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  authorization_id UUID REFERENCES authorizations(id),
  program_id      UUID NOT NULL REFERENCES programs(id),
  dispute_type    TEXT NOT NULL,
  -- 'UNAUTHORIZED', 'ITEM_NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DUPLICATE',
  -- 'CREDIT_NOT_PROCESSED', 'OTHER'
  status          TEXT NOT NULL DEFAULT 'SUBMITTED',
  -- SUBMITTED, UNDER_REVIEW, PROVISIONAL_CREDIT_ISSUED, WON, LOST, WITHDRAWN
  amount          BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  description     TEXT NOT NULL,
  evidence_s3_keys TEXT[],
  provisional_credit_entry_id UUID REFERENCES journal_entries(id),
  resolution_entry_id         UUID REFERENCES journal_entries(id),
  assigned_to     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT,
  merchant_response JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Dispute flow:**
1. Cardholder submits dispute via portal
2. System checks: is the authorization < 120 days old? (Visa/MC chargeback window)
3. Provisional credit issued immediately (DR Program Float, CR Card Account) for disputes marked `UNAUTHORIZED`
4. Support agent reviews within 72h
5. If merchant response received within 30 days: adjudicate
6. If merchant does not respond: rule in favor of cardholder, keep provisional credit posted
7. If ruled against cardholder: reverse provisional credit, notify cardholder

### 13.4 Reload / Top-Up

```typescript
// Stripe integration for reload
async function initiateReload(cardId: string, amount: bigint, paymentMethodId: string): Promise<{ clientSecret: string }> {
  const card = await db.cards.findUniqueOrThrow({ where: { id: cardId } });

  // Validate amount
  if (amount < 100n) throw new AppError(400, 'MIN_RELOAD_AMOUNT', 'Minimum reload is $1.00');
  if (amount > 50000n) throw new AppError(400, 'MAX_RELOAD_AMOUNT', 'Maximum reload is $500.00');

  // Create Stripe PaymentIntent
  const intent = await stripe.paymentIntents.create({
    amount: Number(amount),
    currency: card.currency.toLowerCase(),
    payment_method: paymentMethodId,
    confirm: false,
    metadata: { cardId, type: 'RELOAD' },
  });

  // Store pending reload
  await db.pendingReloads.create({
    data: { cardId, amount, currency: card.currency, stripePaymentIntentId: intent.id, status: 'PENDING' },
  });

  return { clientSecret: intent.client_secret! };
}

// Stripe webhook: payment_intent.succeeded
async function onReloadSuccess(paymentIntentId: string): Promise<void> {
  const pending = await db.pendingReloads.findUniqueOrThrow({ where: { stripePaymentIntentId: paymentIntentId } });
  const card = await db.cards.findUniqueOrThrow({ where: { id: pending.cardId } });

  await postJournalEntry({
    type: 'RELOAD',
    programId: card.programId,
    description: `Cardholder reload via card payment`,
    lines: [
      { accountId: card.program.floatAccountId, direction: 'DEBIT', amount: pending.amount },
      { accountId: card.accountId, direction: 'CREDIT', amount: pending.amount },
    ],
  });

  await db.pendingReloads.update({ where: { id: pending.id }, data: { status: 'COMPLETED' } });
  await db.cards.update({ where: { id: card.id }, data: { lastUsedAt: new Date() } });
  await notifyCardholder(card, 'RELOAD_SUCCESS', { amount: pending.amount });
}
```

### 13.5 Digital Wallet Integration (Apple Pay / Google Pay)

Digital wallet provisioning uses the card network's (Visa/MC) token service. The platform does not handle this directly — it integrates with a processor (Marqeta, Galileo, i2c) that manages the Visa Token Service (VTS) or Mastercard Digital Enablement Service (MDES) provisioning flow.

```typescript
// Provisioning request to processor
async function initiateWalletProvisioning(
  cardId: string, walletType: 'APPLE_PAY' | 'GOOGLE_PAY', deviceId: string
): Promise<{ activationData: string; encryptedPassData: string }> {
  const card = await db.cards.findUniqueOrThrow({ where: { id: cardId } });
  const vaultMeta = await vaultClient.getTokenMetadata(card.vaultToken);

  const result = await processorClient.provisionWalletToken({
    pan_token: card.vaultToken,
    wallet_provider: walletType === 'APPLE_PAY' ? 'APPLE' : 'GOOGLE',
    device_id: deviceId,
    cardholder_name: card.recipientName ?? 'Gift Card',
  });

  await db.walletTokens.create({
    data: { cardId, walletType, walletToken: result.wallet_token, deviceId, status: 'ACTIVE' },
  });

  return { activationData: result.activation_data, encryptedPassData: result.encrypted_pass_data };
}
```

---

## 14. Notification Architecture

### 14.1 Event-Driven Notifications

All notifications are triggered by events on the Kafka `card-events` topic. The notification service is a consumer group that translates events to deliveries.

```typescript
const NOTIFICATION_EVENTS = {
  'card.issued':              ['EMAIL'],
  'card.activated':           ['EMAIL', 'SMS'],
  'card.authorized':          ['PUSH', 'SMS'],   // only if amount > threshold
  'card.declined':            ['PUSH', 'SMS'],
  'card.balance_low':         ['EMAIL', 'PUSH'],  // < 10% of initial load
  'card.expiring_soon':       ['EMAIL'],           // 60 days before expiry
  'card.expired':             ['EMAIL'],
  'card.reloaded':            ['EMAIL', 'SMS'],
  'card.frozen':              ['EMAIL', 'SMS'],
  'card.pin_changed':         ['EMAIL'],
  'dispute.submitted':        ['EMAIL'],
  'dispute.resolved':         ['EMAIL'],
  'card.esheated':            ['EMAIL'],
  'dormancy.fee_assessed':    ['EMAIL'],
};
```

### 14.2 Email Architecture

```typescript
// Transactional emails via AWS SES (primary) with SendGrid fallback
// Template engine: MJML → HTML (responsive email templates)
// Unsubscribe: one-click List-Unsubscribe header + footer link

interface EmailMessage {
  to: string;
  templateId: string;
  variables: Record<string, string | number>;
  idempotencyKey: string;     // prevent duplicate sends on retry
  unsubscribeToken?: string;
}
```

All email templates are stored in S3 as MJML source. The notification service compiles them on first use and caches the compiled HTML. Template variables are HTML-escaped before injection.

---

## 15. Reporting, Analytics & Data Warehouse

### 15.1 Report Architecture

Reports are separated into two tiers:

**Tier 1: Operational Reports** (OLTP — served from read replica)
- Current balances, recent transactions, card status breakdowns
- Generated on demand, cached in Redis for 5 minutes
- Format: JSON (API) and CSV (download)

**Tier 2: Analytical Reports** (OLAP — served from data warehouse)
- Historical trends, cohort analysis, breakage modeling, liability reconciliation
- Generated as scheduled jobs, stored in S3
- Format: CSV, XLSX, PDF

### 15.2 Data Warehouse Pipeline

```
PostgreSQL (primary)
  → Debezium CDC connector
  → Kafka topic: db.public.journal_entries, db.public.cards, ...
  → Kafka Connect S3 Sink connector
  → S3 Data Lake (Parquet, partitioned by date)
  → AWS Athena (query engine) or Snowflake
  → Looker / Metabase (visualization)
```

### 15.3 Six Standard Reports

| Report | Data Source | Schedule |
|--------|------------|----------|
| Liability Report | Ledger — sum of all CARD account balances | Daily |
| Breakage Report | Historical redemption rates by cohort | Monthly |
| Escheatment Report | escheatment_records | Quarterly |
| Settlement Report | settlement_runs + settlement_lines | Per settlement cycle |
| Float Reconciliation | Float vs. card balance delta | Daily |
| Fraud & Velocity Report | fraud_flags + authorizations | Daily |

---

## 16. Integration Layer

### 16.1 SFTP Batch Processing

Enterprise clients (banks, large retailers) exchange card files via SFTP rather than API.

```
Supported formats:
  - Issuance: CSV (card number, recipient, amount, expiry date, program)
  - Redemption: ISO 8583 batch file
  - Settlement: MT940 / CAMT.053 bank statement format
  - Reports: CSV, fixed-width text

SFTP infrastructure:
  - AWS Transfer Family (managed SFTP, no server management)
  - One S3 prefix per client: s3://platform-sftp/{client_id}/inbound/
  - S3 event → Lambda → SQS → SFTP processing worker
  - Processing worker validates, transforms, and calls internal API
  - Results written to s3://platform-sftp/{client_id}/outbound/
  - PGP encryption on all files (client provides public key)
```

### 16.2 HR Integration

When an employee lifecycle event occurs (new hire, anniversary, performance award), the HR system triggers a webhook to the platform:

```typescript
interface HrEvent {
  eventType: 'NEW_HIRE' | 'WORK_ANNIVERSARY' | 'PERFORMANCE_AWARD' | 'BIRTHDAY' | 'RETIREMENT';
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  departmentId: string;
  programSlug: string;
  campaignSlug?: string;
  overrideAmountCents?: number;  // optional override; else uses program default
}
```

The HR integration module maps event types to issuance rules configured per program (e.g., `NEW_HIRE` → $250 card, `WORK_ANNIVERSARY` → $50 × years of service).

### 16.3 Webhook Delivery

```typescript
// Outbound webhooks to merchant/partner systems
interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXHAUSTED';
  attemptCount: number;
  nextAttemptAt: Date;
  lastHttpStatus?: number;
  lastResponseBody?: string;
  createdAt: Date;
}

// Retry schedule: 1m, 5m, 30m, 2h, 8h, 24h (6 attempts, then EXHAUSTED)
function nextRetryDelay(attemptCount: number): number {
  const delays = [60, 300, 1800, 7200, 28800, 86400];
  return delays[Math.min(attemptCount, delays.length - 1)] * 1000;
}

// Signature: HMAC-SHA-256 over raw body with endpoint secret
// Header: X-GiftCard-Signature: sha256=<hex>
// Header: X-GiftCard-Timestamp: <unix timestamp>
// Replay window: reject if timestamp is > 5 minutes old
```

---

## 17. API Design Standards

### 17.1 Versioning

All API endpoints are versioned via URL prefix: `/api/v1/`, `/api/v2/`. Breaking changes (removed fields, changed semantics) require a new version. Additive changes (new optional fields) are non-breaking and do not require a new version. Each version is supported for a minimum of 18 months after its successor is released.

### 17.2 Request / Response Envelope

```typescript
// Success
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",      // UUID, logged for support
    "version": "2025-01-01",        // API version date
    "page": 1,                      // for paginated responses
    "pageSize": 50,
    "total": 1234
  }
}

// Error
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The card does not have sufficient balance for this transaction.",
    "requestId": "req_abc123",
    "details": { "available": 2500, "requested": 5000 }
  }
}
```

### 17.3 Idempotency

Every mutation endpoint (`POST`, `PATCH`, `DELETE`) requires the `Idempotency-Key` header (UUID v4). The server stores `(key, method, normalized_path) → (response_status, response_body)` for 24 hours. Duplicate requests within the window return the original response. Mismatched request body (same key, different body) returns 422 with `IDEMPOTENCY_KEY_REUSED`.

### 17.4 Pagination

All list endpoints use cursor-based pagination:

```
GET /api/v1/cards?cursor=<opaque_cursor>&limit=50
Response: { "data": [...], "meta": { "nextCursor": "...", "hasMore": true } }
```

Cursors are base64-encoded sort key + ID tuples. Offset pagination is not supported on large tables — it performs a full table scan to skip rows.

### 17.5 Rate Limiting

| Tier | Limit | Window | Scope |
|------|-------|--------|-------|
| Global (unauthenticated) | 100 | 1 minute | IP |
| Authentication endpoints | 20 | 15 minutes | IP |
| Balance check (public portal) | 30 | 1 minute | IP |
| API key (live) | 1,000 | 1 minute | API key |
| API key (test) | 5,000 | 1 minute | API key |
| Burst (live) | 50 | 1 second | API key |

Rate limit headers on every response:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1735689600
Retry-After: 42   (only on 429)
```

### 17.6 Monetary Amount Handling

All amounts in the API are represented as integers in minor currency units (cents for USD). Never use floating point.

```typescript
// Request
{ "amount": 5000 }     // = $50.00 USD

// Response
{ "balance": 7550 }    // = $75.50 USD
{ "currency": "USD" }  // always accompany amount with currency
```

---

## 18. Infrastructure & Deployment

### 18.1 Container Architecture

```yaml
# Core platform containers (per environment)
services:
  api:            # Core platform modular monolith (3 replicas min)
  worker:         # Bull queue workers — separate process, same codebase
  vault:          # Tokenization vault (PCI zone, isolated)
  fraud-engine:   # Fraud decisioning (separate process)
  notifier:       # Notification/webhook dispatcher
  scheduler:      # Cron jobs (single instance with leader election via Redis)

  # Infrastructure
  postgres:       # Primary (or RDS Multi-AZ in production)
  postgres-read:  # Read replica (or RDS read replica)
  redis:          # Redis Cluster (or ElastiCache)
  kafka:          # Kafka (or MSK)
  prometheus:     # Metrics scraping
  grafana:        # Dashboards
  loki:           # Log aggregation
```

### 18.2 Database Configuration

```sql
-- Connection pooling via PgBouncer (transaction mode)
-- Core platform → PgBouncer → PostgreSQL primary
-- Read-heavy queries → PgBouncer → PostgreSQL read replica

-- Key PostgreSQL settings for financial workloads:
-- synchronous_commit = on          (never lose a committed transaction)
-- wal_level = logical              (for Debezium CDC)
-- max_wal_senders = 10
-- checkpoint_completion_target = 0.9
-- effective_cache_size = 3/4 of RAM
-- shared_buffers = 1/4 of RAM
-- work_mem = 64MB                  (for sorts/hashes in reports)
-- lock_timeout = '5s'             (prevent long waits on advisory locks)
-- statement_timeout = '30s'        (catch runaway queries)
-- idle_in_transaction_session_timeout = '60s'
```

### 18.3 Secret Management

All secrets are stored in HashiCorp Vault (or AWS Secrets Manager). Application reads secrets at startup via the Vault agent sidecar, which also handles token renewal. Secrets are never stored in environment variable files on disk in production.

```typescript
// Secret categories
const SECRETS = {
  DATABASE_URL:         'secret/platform/database',
  REDIS_URL:            'secret/platform/redis',
  KAFKA_CREDENTIALS:    'secret/platform/kafka',
  JWT_PRIVATE_KEY:      'secret/platform/jwt/private',
  JWT_PUBLIC_KEY:       'secret/platform/jwt/public',
  VAULT_CLIENT_CERT:    'secret/platform/vault/client-cert',
  VAULT_CLIENT_KEY:     'secret/platform/vault/client-key',
  STRIPE_SECRET_KEY:    'secret/platform/stripe',
  SES_CREDENTIALS:      'secret/platform/ses',
  S3_CREDENTIALS:       'secret/platform/s3',
  OFAC_API_KEY:         'secret/platform/ofac',
  FRAUD_MODEL_KEY:      'secret/platform/fraud',
};
```

### 18.4 High Availability

| Component | HA Strategy |
|-----------|------------|
| API | 3+ replicas behind load balancer, health check `/health/live` |
| PostgreSQL | Multi-AZ with automatic failover (RDS) or Patroni |
| Redis | Redis Sentinel or Elasticache cluster mode |
| Kafka | 3-broker cluster, replication factor 3, min.insync.replicas 2 |
| Vault (tokenization) | Active-passive with shared HSM |
| Bull workers | N replicas, jobs claimed via Redis BRPOPLPUSH |

### 18.5 Backup Strategy

| Data | Backup Method | Frequency | Retention |
|------|--------------|-----------|-----------|
| PostgreSQL | Continuous WAL archiving to S3 | Streaming | 35 days |
| PostgreSQL | pg_dump snapshot | 6 hours | 14 dumps |
| Redis | RDB snapshot | 1 hour | 48 snapshots |
| S3 (exports, filings) | Cross-region replication | Continuous | 7 years (compliance) |
| Vault DB (PANs) | Encrypted snapshot | 6 hours | 7 years |
| Audit logs | Immutable S3 Object Lock | Streaming | 7 years |

Financial records (journal entries, authorizations, audit logs) are retained for 7 years per BSA/AML requirements. They are moved to Glacier after 2 years. They are never deleted.

---

## 19. Observability

### 19.1 Structured Logging

Every log line is JSON with a fixed schema:

```typescript
{
  "timestamp": "2025-01-15T14:23:01.123Z",
  "level": "info",                     // trace, debug, info, warn, error, fatal
  "service": "api",
  "version": "2.4.1",
  "requestId": "req_abc123",
  "userId": "usr_xyz789",
  "programId": "prog_def456",
  "method": "POST",
  "path": "/api/v1/cards/:id/authorize",
  "statusCode": 200,
  "durationMs": 47,
  "message": "Authorization approved",
  "cardId": "card_...",
  "authorizationId": "auth_...",
  "fraudScore": 12,
  "tags": ["authorization", "approved"]
}
```

**Never log:** PANs, full card numbers, PINs, passwords, API keys, SSNs, bank account numbers, raw request bodies on auth endpoints.

### 19.2 Key Metrics

```
# Business metrics
gift_card_authorizations_total{program, decision, entry_mode}
gift_card_authorization_amount_cents{program, currency}
gift_card_balance_total_cents{program, currency}    -- gauge, from reconciliation job
gift_card_float_variance_cents{program}              -- should always be ~0
gift_card_fraud_flags_total{program, severity, source}
gift_card_escheatment_amount_cents{program, state}

# Technical metrics
http_request_duration_seconds{method, path, status}
db_query_duration_seconds{operation, table}
kafka_consumer_lag{topic, consumer_group}
redis_command_duration_seconds{command}
fraud_engine_latency_seconds
vault_request_duration_seconds{operation}

# Compliance metrics
card_act_fee_assessments_total{program}
kyc_check_results_total{program, provider, result}
ofac_screen_hits_total{program}
```

### 19.3 Alerting Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| Reconciliation variance | |variance| > $1.00 | CRITICAL | Page on-call, auto-suspend issuance |
| Authorization success rate | < 95% in 5m | HIGH | Page on-call |
| Fraud flag rate | > 5% of auths in 1h | HIGH | Page fraud team |
| Float below threshold | float < 110% of liability | WARNING | Alert finance |
| JWT key rotation overdue | last rotation > 89 days | WARNING | Alert ops |
| OFAC match | any match | CRITICAL | Freeze card, alert compliance |
| DB replication lag | > 30 seconds | HIGH | Page on-call |
| Kafka consumer lag | > 10,000 messages | WARNING | Alert ops |

---

## 20. Migration Roadmap

### Phase 0: Foundation (Weeks 1-4)

Build the infrastructure layer before any new features. Nothing migrates yet.

1. Stand up PostgreSQL with the new schema (parallel to existing DB)
2. Deploy tokenization vault service in PCI zone
3. Deploy Kafka cluster with initial topics
4. Implement double-entry ledger core (accounts, journal_entries, journal_lines)
5. Implement idempotency key middleware
6. Write the balance computation function + checkpoint writer
7. Write reconciliation job (verify it against existing balance column)
8. Write all constraint triggers and verify with unit tests

**Exit criterion:** Run reconciliation against existing data — derived balances must match stored balances within rounding tolerance on 100% of cards.

### Phase 1: Auth/Capture Model (Weeks 5-8)

Migrate from single-step transactions to the AUTH → CAPTURE model.

1. Deploy fraud engine (velocity rules only — no ML model yet)
2. Implement `authorizations` table and state machine
3. Migrate card issuance to post LOAD journal entries
4. Implement capture and void endpoints
5. Implement expired auth sweeper
6. Shadow-run: new auth/capture against existing transaction model, compare results

### Phase 2: Tokenization Migration (Weeks 9-12)

Migrate all existing PANs to the vault.

1. One-time batch: read each existing card number → POST to vault → store token
2. Delete PANs from app DB (replace column with token column)
3. All new card generation goes through vault
4. Update PIN storage to separate `card_pins` table
5. Rotate all encryption keys now that PANs are vaulted

**This phase reduces PCI scope.** Schedule QSA audit after phase completes.

### Phase 3: Compliance Engine (Weeks 13-18)

1. Implement CARD Act expiry enforcement (backfill any cards with < 5-year expiry)
2. Implement dormancy fee assessment job
3. Implement escheatment tracking and NAUPA file generation
4. Implement AML/OFAC screening (screen all existing active cards against SDN list)
5. Implement CTR/SAR workflow
6. Implement KYC check integration with chosen vendor

### Phase 4: Settlement Engine (Weeks 19-24)

1. Migrate merchant data to `settlement_parties` table
2. Implement `redemption_party_links` backfill from existing transaction metadata
3. Implement weekly settlement run job
4. Implement GL mapping configuration
5. Implement GL export for each supported ERP format
6. Implement float reconciliation reporting

### Phase 5: Cardholder Features (Weeks 25-30)

1. Rebuild cardholder portal on new API
2. Implement reload / top-up (Stripe integration)
3. Implement auto-reload
4. Implement dispute workflow
5. Implement digital wallet provisioning
6. Implement PIN management (change, reset via OTP)

### Phase 6: Fraud ML & Advanced Features (Weeks 31-36)

1. Collect labeled training data from phase 1-5 authorizations
2. Train initial XGBoost model
3. Deploy fraud engine with ML layer
4. Implement model feedback loop (chargeback → label → retrain)
5. Implement SFTP batch processing
6. Implement data warehouse pipeline (Debezium + S3 + Athena)

### Phase 7: Hardening & Certification (Weeks 37-42)

1. Penetration testing (external firm)
2. PCI DSS QSA audit (scope: vault only)
3. SOC 2 Type II audit evidence collection
4. Load testing: 10,000 authorizations/minute sustained
5. Disaster recovery drill: failover PostgreSQL, measure RTO/RPO
6. Complete documentation update

---

## Appendix A: Error Code Reference

| Code | HTTP | Meaning |
|------|------|---------|
| `INSUFFICIENT_FUNDS` | 402 | Card balance too low |
| `CARD_NOT_FOUND` | 404 | Card does not exist or is not in scope |
| `CARD_SUSPENDED` | 403 | Card is frozen |
| `CARD_EXPIRED` | 410 | Card has passed its expiry date |
| `CARD_CANCELLED` | 410 | Card has been permanently cancelled |
| `INVALID_PIN` | 401 | PIN does not match |
| `PIN_LOCKED` | 423 | PIN locked after too many attempts |
| `FRAUD_DECLINE` | 402 | Authorization declined by fraud engine |
| `VELOCITY_EXCEEDED` | 429 | Velocity rule triggered |
| `AUTHORIZATION_EXPIRED` | 410 | Auth cannot be captured — expired |
| `CAPTURE_EXCEEDS_AUTH` | 422 | Capture amount > authorized amount |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different request body |
| `INVALID_CREDENTIALS` | 401 | Email or password incorrect |
| `TOTP_REQUIRED` | 403 | 2FA code required |
| `INVALID_TOTP_CODE` | 401 | 2FA code incorrect |
| `KYC_REQUIRED` | 403 | Card blocked pending identity verification |
| `OFAC_MATCH` | 403 | OFAC sanctions screening positive match |
| `PROGRAM_BUDGET_EXCEEDED` | 402 | Order would exceed program budget cap |
| `PROGRAM_SUSPENDED` | 503 | Program is suspended (check reconciliation) |
| `RECONCILIATION_HOLD` | 503 | Float variance detected — issuance suspended |
| `RATE_LIMITED` | 429 | Too many requests |
| `INVALID_AMOUNT` | 400 | Amount must be a positive integer in minor units |
| `INVALID_CURRENCY` | 400 | Currency not supported by program |

---

## Appendix B: Kafka Topic Inventory

| Topic | Partitions | Retention | Consumers |
|-------|-----------|-----------|-----------|
| `card-events` | 12 | 7 days | Notifier, Fraud Engine, Data Warehouse ETL |
| `authorization-events` | 24 | 7 days | Fraud Engine, Settlement, Data Warehouse ETL |
| `ledger-entries` | 12 | 30 days | GL Exporter, Reconciliation, Data Warehouse ETL |
| `compliance-events` | 6 | 90 days | Escheatment Engine, SAR workflow |
| `webhook-deliveries` | 12 | 3 days | Webhook dispatcher |
| `audit-log` | 6 | 365 days | Audit archive (S3), SIEM |
| `settlement-events` | 6 | 30 days | GL Exporter, Finance alerts |

---

## Appendix C: Technology Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Prisma + raw SQL for complex queries | Prisma for CRUD, raw SQL for aggregations and window functions |
| Auth tokens | RS256 JWT (asymmetric) | Public key verifiable by downstream services without shared secret |
| Money type | PostgreSQL BIGINT (minor units) | No floating-point errors; exact arithmetic |
| Event streaming | Kafka | Durable, replayable, high-throughput; Kafka Connect for CDC |
| Cache | Redis 7 Cluster | Velocity rule evaluation, idempotency, session storage, rate limits |
| Fraud scoring | gRPC (protobuf) | Low latency, strongly typed, streaming support for model updates |
| Key management | HashiCorp Vault + HSM | Meets PCI DSS key management requirements |
| PAN tokenization | Deterministic HMAC | Enables deduplication without storing PANs |
| Queue | BullMQ (Redis-backed) | Reliable job processing with exponential backoff |
| Email | AWS SES primary + SendGrid fallback | SES cost at scale; SendGrid for fallback and advanced templates |
| File storage | S3-compatible | Escrow filings, SFTP drops, report exports |
| Monitoring | Prometheus + Grafana + Loki | Open source, self-hosted, full control |
| Deployment | Docker + ECS (or Kubernetes) | Container orchestration with per-service scaling |

---

*End of Architecture Document — Version 1.0*
*Prepared for: Gift Card Platform Rearchitecture Initiative*
*Classification: Internal — Confidential*


*Notes from ChatGPT*
Adopt the attached notes as the core architecture, but adjust them in three important ways:

Use “Credential Vault” as the general concept. For closed-loop restaurant or retail gift cards, the stored credential may not be a payment-card PAN. If open-loop prepaid cards are later supported, then PAN tokenization and PCI scope become more directly relevant. The architecture should support both, but the default gift card system should not overstate PCI obligations for closed-loop gift card numbers.

Separate authorization holds from financial settlement. Authorization should reduce available balance, but final settlement should be represented through settlement payable/suspense accounts. Do not make authorization/capture logic accidentally distort float accounting.

Gate AML/KYC/OFAC/SAR/CTR features by program type. These should exist architecturally, but they should be configurable. A closed-loop restaurant gift card program does not need the same controls as an open-loop prepaid card or high-value corporate stored-value program.