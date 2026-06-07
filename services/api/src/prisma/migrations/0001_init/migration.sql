-- CreateTable
CREATE TABLE "settlement_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "party_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "settlement_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "settlement_frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
    "bank_account_token" TEXT,
    "float_account_id" UUID,
    "suspense_account_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "parent_party_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "open_loop" BOOLEAN NOT NULL DEFAULT false,
    "card_expiry_days" INTEGER NOT NULL DEFAULT 1825,
    "dormancy_fee_cents" BIGINT NOT NULL DEFAULT 0,
    "dormancy_months" INTEGER NOT NULL DEFAULT 12,
    "budget_cap" BIGINT,
    "approval_threshold" BIGINT NOT NULL DEFAULT 500000,
    "auto_approve_limit" BIGINT NOT NULL DEFAULT 100000,
    "kyc_required_above" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "float_account_id" UUID,
    "liability_account_id" UUID,
    "breakage_account_id" UUID,
    "fee_account_id" UUID,
    "escrow_account_id" UUID,
    "owner_party_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_type" TEXT NOT NULL,
    "normal_balance" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "program_id" UUID,
    "card_id" UUID,
    "party_id" UUID,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT,
    "authorization_id" UUID,
    "order_id" UUID,
    "program_id" UUID NOT NULL,
    "initiated_by" UUID,
    "external_ref" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "checkpoint_at" TIMESTAMP(3) NOT NULL,
    "last_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "sso_provider" TEXT,
    "sso_subject" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "program_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret" TEXT,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "failed_attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "reset_token_hash" TEXT,
    "reset_expires_at" TIMESTAMP(3),
    "totp_pending_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "replaced_by" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "key_prefix" CHAR(12) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bonus_load_percent" DECIMAL(5,2),
    "expiry_days" INTEGER,
    "max_cards" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "budget_cap" BIGINT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "campaign_id" UUID,
    "account_id" UUID NOT NULL,
    "vault_token" TEXT NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "bin" VARCHAR(8) NOT NULL,
    "card_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "currency" CHAR(3) NOT NULL,
    "initial_load" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "activated_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "kyc_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "recipient_name" TEXT,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "recipient_state" CHAR(2),
    "department_id" UUID,
    "issued_by" UUID,
    "order_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_pins" (
    "card_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "last_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_pins_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "authorizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_amount" BIGINT NOT NULL,
    "authorized_amount" BIGINT NOT NULL,
    "captured_amount" BIGINT NOT NULL DEFAULT 0,
    "reversed_amount" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "merchant_name" TEXT,
    "merchant_mcc" CHAR(4),
    "merchant_country" CHAR(2),
    "pos_entry_mode" TEXT,
    "retrieval_ref" TEXT,
    "auth_code" CHAR(6),
    "fraud_score" SMALLINT,
    "fraud_decision" TEXT,
    "decline_code" TEXT,
    "idempotency_key" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    "authorized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "campaign_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_cards" INTEGER NOT NULL,
    "processed_cards" INTEGER NOT NULL DEFAULT 0,
    "failed_cards" INTEGER NOT NULL DEFAULT 0,
    "total_amount_cents" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "csv_s3_key" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "recipient_name" TEXT,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "amount_cents" BIGINT NOT NULL,
    "card_type" TEXT NOT NULL DEFAULT 'VIRTUAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "card_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "check_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reference_id" TEXT,
    "risk_score" SMALLINT,
    "reason_codes" TEXT[],
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sar_filings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "card_id" UUID,
    "filing_type" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "amount" BIGINT,
    "currency" CHAR(3),
    "fincen_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sar_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "velocity_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "max_count" INTEGER,
    "max_amount" BIGINT,
    "action" TEXT NOT NULL DEFAULT 'FLAG',
    "priority" SMALLINT NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "velocity_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID,
    "authorization_id" UUID,
    "program_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "rule_id" UUID,
    "reason_code" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "score" SMALLINT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_fingerprints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "fingerprint_hash" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "risk_signals" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "device_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gross_redemptions" BIGINT NOT NULL DEFAULT 0,
    "fees_withheld" BIGINT NOT NULL DEFAULT 0,
    "net_payable" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "payment_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "authorization_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "line_type" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_party_links" (
    "authorization_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "merchant_token" TEXT NOT NULL,
    "split_percent" DECIMAL(5,2),

    CONSTRAINT "redemption_party_links_pkey" PRIMARY KEY ("authorization_id","party_id")
);

-- CreateTable
CREATE TABLE "dormancy_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "dormant_since" TIMESTAMP(3) NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "months_dormant" INTEGER NOT NULL,
    "entry_id" UUID,
    "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "waived_reason" TEXT,

    CONSTRAINT "dormancy_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escheatment_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "holder_state" CHAR(2),
    "property_type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dormant_since" TIMESTAMP(3) NOT NULL,
    "eligible_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filing_id" UUID,
    "entry_id" UUID,
    "reported_at" TIMESTAMP(3),
    "remitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escheatment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escheatment_filings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "report_year" SMALLINT NOT NULL,
    "report_period" TEXT NOT NULL,
    "naupa_s3_key" TEXT,
    "total_amount" BIGINT NOT NULL,
    "record_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escheatment_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "authorization_id" UUID,
    "program_id" UUID NOT NULL,
    "dispute_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence_s3_keys" TEXT[],
    "provisional_credit_entry_id" UUID,
    "resolution_entry_id" UUID,
    "assigned_to" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "merchant_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "wallet_token" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_reloads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "card_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stripe_payment_intent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_reloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpoint_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_http_status" SMALLINT,
    "last_response_body" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR(128) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "response_status" SMALLINT NOT NULL,
    "response_body" JSONB NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key","method","path")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_email" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "program_id" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "account_type" TEXT NOT NULL,
    "gl_account_code" TEXT NOT NULL,
    "gl_description" TEXT NOT NULL,
    "erp_system" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gl_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_event_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "campaign_id" UUID,
    "amount_cents" BIGINT NOT NULL,
    "card_type" TEXT NOT NULL DEFAULT 'VIRTUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_event_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "float_balance" BIGINT NOT NULL,
    "total_card_balances" BIGINT NOT NULL,
    "pending_auths" BIGINT NOT NULL,
    "variance" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_parties_float_account_id_key" ON "settlement_parties"("float_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_parties_suspense_account_id_key" ON "settlement_parties"("suspense_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_slug_key" ON "programs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "programs_float_account_id_key" ON "programs"("float_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_liability_account_id_key" ON "programs"("liability_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_breakage_account_id_key" ON "programs"("breakage_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_fee_account_id_key" ON "programs"("fee_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_escrow_account_id_key" ON "programs"("escrow_account_id");

-- CreateIndex
CREATE INDEX "accounts_card_id_idx" ON "accounts"("card_id");

-- CreateIndex
CREATE INDEX "accounts_program_id_idx" ON "accounts"("program_id");

-- CreateIndex
CREATE INDEX "accounts_account_type_status_idx" ON "accounts"("account_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "journal_entries_program_id_idx" ON "journal_entries"("program_id");

-- CreateIndex
CREATE INDEX "journal_entries_entry_type_idx" ON "journal_entries"("entry_type");

-- CreateIndex
CREATE INDEX "journal_entries_posted_at_idx" ON "journal_entries"("posted_at" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_idempotency_key_idx" ON "journal_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_created_at_idx" ON "journal_lines"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "balance_checkpoints_account_id_checkpoint_at_idx" ON "balance_checkpoints"("account_id", "checkpoint_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "balance_checkpoints_account_id_checkpoint_at_key" ON "balance_checkpoints"("account_id", "checkpoint_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_program_id_idx" ON "users"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_sso_provider_sso_subject_key" ON "users"("sso_provider", "sso_subject");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_program_id_idx" ON "api_keys"("program_id");

-- CreateIndex
CREATE INDEX "campaigns_program_id_idx" ON "campaigns"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_program_id_name_key" ON "departments"("program_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cards_account_id_key" ON "cards"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_vault_token_key" ON "cards"("vault_token");

-- CreateIndex
CREATE INDEX "cards_program_id_idx" ON "cards"("program_id");

-- CreateIndex
CREATE INDEX "cards_status_idx" ON "cards"("status");

-- CreateIndex
CREATE INDEX "cards_expires_at_idx" ON "cards"("expires_at");

-- CreateIndex
CREATE INDEX "cards_last_used_at_idx" ON "cards"("last_used_at");

-- CreateIndex
CREATE INDEX "cards_vault_token_idx" ON "cards"("vault_token");

-- CreateIndex
CREATE INDEX "cards_order_id_idx" ON "cards"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "authorizations_idempotency_key_key" ON "authorizations"("idempotency_key");

-- CreateIndex
CREATE INDEX "authorizations_card_id_idx" ON "authorizations"("card_id");

-- CreateIndex
CREATE INDEX "authorizations_status_idx" ON "authorizations"("status");

-- CreateIndex
CREATE INDEX "authorizations_expires_at_idx" ON "authorizations"("expires_at");

-- CreateIndex
CREATE INDEX "orders_program_id_idx" ON "orders"("program_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_line_items_order_id_idx" ON "order_line_items"("order_id");

-- CreateIndex
CREATE INDEX "kyc_checks_card_id_idx" ON "kyc_checks"("card_id");

-- CreateIndex
CREATE INDEX "kyc_checks_program_id_status_idx" ON "kyc_checks"("program_id", "status");

-- CreateIndex
CREATE INDEX "sar_filings_program_id_idx" ON "sar_filings"("program_id");

-- CreateIndex
CREATE INDEX "velocity_rules_program_id_enabled_idx" ON "velocity_rules"("program_id", "enabled");

-- CreateIndex
CREATE INDEX "fraud_flags_program_id_status_idx" ON "fraud_flags"("program_id", "status");

-- CreateIndex
CREATE INDEX "fraud_flags_card_id_idx" ON "fraud_flags"("card_id");

-- CreateIndex
CREATE INDEX "device_fingerprints_card_id_idx" ON "device_fingerprints"("card_id");

-- CreateIndex
CREATE INDEX "device_fingerprints_fingerprint_hash_idx" ON "device_fingerprints"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "device_fingerprints_ip_address_idx" ON "device_fingerprints"("ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_runs_entry_id_key" ON "settlement_runs"("entry_id");

-- CreateIndex
CREATE INDEX "settlement_runs_program_id_idx" ON "settlement_runs"("program_id");

-- CreateIndex
CREATE INDEX "settlement_runs_party_id_idx" ON "settlement_runs"("party_id");

-- CreateIndex
CREATE INDEX "settlement_lines_run_id_idx" ON "settlement_lines"("run_id");

-- CreateIndex
CREATE INDEX "dormancy_assessments_card_id_idx" ON "dormancy_assessments"("card_id");

-- CreateIndex
CREATE INDEX "dormancy_assessments_program_id_idx" ON "dormancy_assessments"("program_id");

-- CreateIndex
CREATE INDEX "escheatment_records_program_id_state_code_idx" ON "escheatment_records"("program_id", "state_code");

-- CreateIndex
CREATE INDEX "escheatment_records_status_idx" ON "escheatment_records"("status");

-- CreateIndex
CREATE INDEX "escheatment_filings_program_id_state_code_idx" ON "escheatment_filings"("program_id", "state_code");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_provisional_credit_entry_id_key" ON "disputes"("provisional_credit_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_resolution_entry_id_key" ON "disputes"("resolution_entry_id");

-- CreateIndex
CREATE INDEX "disputes_card_id_idx" ON "disputes"("card_id");

-- CreateIndex
CREATE INDEX "disputes_program_id_status_idx" ON "disputes"("program_id", "status");

-- CreateIndex
CREATE INDEX "wallet_tokens_card_id_idx" ON "wallet_tokens"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_reloads_stripe_payment_intent_id_key" ON "pending_reloads"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "pending_reloads_card_id_idx" ON "pending_reloads"("card_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_program_id_idx" ON "webhook_endpoints"("program_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_idx" ON "webhook_deliveries"("endpoint_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_program_id_idx" ON "audit_logs"("program_id");

-- CreateIndex
CREATE INDEX "audit_logs_category_idx" ON "audit_logs"("category");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "gl_mappings_program_id_account_type_key" ON "gl_mappings"("program_id", "account_type");

-- CreateIndex
CREATE UNIQUE INDEX "hr_event_rules_program_id_event_type_key" ON "hr_event_rules"("program_id", "event_type");

-- CreateIndex
CREATE INDEX "reconciliation_logs_program_id_created_at_idx" ON "reconciliation_logs"("program_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_parent_party_id_fkey" FOREIGN KEY ("parent_party_id") REFERENCES "settlement_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_float_account_id_fkey" FOREIGN KEY ("float_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_suspense_account_id_fkey" FOREIGN KEY ("suspense_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_float_account_id_fkey" FOREIGN KEY ("float_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_liability_account_id_fkey" FOREIGN KEY ("liability_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_breakage_account_id_fkey" FOREIGN KEY ("breakage_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_fee_account_id_fkey" FOREIGN KEY ("fee_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_escrow_account_id_fkey" FOREIGN KEY ("escrow_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_party_id_fkey" FOREIGN KEY ("owner_party_id") REFERENCES "settlement_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "authorizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_last_entry_id_fkey" FOREIGN KEY ("last_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_pins" ADD CONSTRAINT "card_pins_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "velocity_rules" ADD CONSTRAINT "velocity_rules_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "authorizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "velocity_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fingerprints" ADD CONSTRAINT "device_fingerprints_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_runs" ADD CONSTRAINT "settlement_runs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_runs" ADD CONSTRAINT "settlement_runs_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "settlement_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_runs" ADD CONSTRAINT "settlement_runs_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "settlement_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_party_links" ADD CONSTRAINT "redemption_party_links_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_party_links" ADD CONSTRAINT "redemption_party_links_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "settlement_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormancy_assessments" ADD CONSTRAINT "dormancy_assessments_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormancy_assessments" ADD CONSTRAINT "dormancy_assessments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormancy_assessments" ADD CONSTRAINT "dormancy_assessments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escheatment_records" ADD CONSTRAINT "escheatment_records_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escheatment_records" ADD CONSTRAINT "escheatment_records_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escheatment_records" ADD CONSTRAINT "escheatment_records_filing_id_fkey" FOREIGN KEY ("filing_id") REFERENCES "escheatment_filings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escheatment_records" ADD CONSTRAINT "escheatment_records_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escheatment_filings" ADD CONSTRAINT "escheatment_filings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_provisional_credit_entry_id_fkey" FOREIGN KEY ("provisional_credit_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolution_entry_id_fkey" FOREIGN KEY ("resolution_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_tokens" ADD CONSTRAINT "wallet_tokens_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_reloads" ADD CONSTRAINT "pending_reloads_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_event_rules" ADD CONSTRAINT "hr_event_rules_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_logs" ADD CONSTRAINT "reconciliation_logs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

