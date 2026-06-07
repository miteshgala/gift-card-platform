# Enterprise Gift Card & Stored-Value Platform Architecture Reference

**Purpose:** Reusable architecture reference for building prompts, product requirements, implementation plans, technical specifications, and Codex development tasks for an enterprise production-grade gift card application.

**Recommended architecture:** Modular monolith core platform, double-entry ledger, isolated credential/tokenization vault, separate low-latency fraud decisioning service, and event-driven downstream workers.

**Version:** 1.0  
**Date:** 2026-05-30

---

## 1. Executive Architecture Summary

Build the gift card platform as a production-grade stored-value financial system, not as a simple card-number-plus-balance application.

The application should be architected as:

```text
Customer Apps / Admin Portal / Corporate Portal / POS / Online Ordering
        │
        ▼
CDN + WAF + API Gateway + Rate Limiting + Auth
        │
        ▼
Core Platform API — Modular Monolith
        │
        ├── Auth / IAM Module
        ├── Tenant / Brand / Location Module
        ├── Program / Campaign Module
        ├── Card Lifecycle Module
        ├── Order / Checkout Module
        ├── Ledger Module
        ├── Redemption Module
        ├── Rules / Policy Module
        ├── Compliance Module
        ├── Settlement Module
        ├── Reconciliation Module
        ├── Reporting Module
        ├── Webhook Module
        └── Notification Module
        │
        ├──────────────► Credential / Tokenization Vault
        │
        ├──────────────► Fraud Decisioning Engine
        │
        └──────────────► Event Bus / Queue
                              │
                              ├── Email / SMS / Wallet Workers
                              ├── Webhook Dispatcher
                              ├── GL / ERP Exporter
                              ├── Data Warehouse ETL
                              ├── Escheatment Jobs
                              └── Fraud Analytics
```

The most important architectural rule:

> The ledger is not a transaction history attached to gift cards. The gift card system is built around the ledger. Cards, orders, redemptions, settlements, refunds, promotions, and compliance workflows all post balanced entries into the ledger.

---

## 2. Core Architecture Principles

### 2.1 Ledger-first design

The system of record is a double-entry ledger. Gift card balances are derived from journal entries and journal lines. The application should not rely on mutable balance fields as the source of truth.

### 2.2 Immutable financial records

Every financial record is append-only. Corrections are made by equal-and-opposite reversals, not by updating or deleting posted amounts.

### 2.3 Balance is always derived

Card balance, promotional balance, auth hold balance, liability, float, breakage, escheatment, and settlement balances are all derived from ledger accounts.

Read-side balance checkpoints may be used for performance, but they are not the source of truth.

### 2.4 Strong consistency for value-changing operations

The following must be strongly consistent:

- card activation
- load
- reload
- authorization
- capture
- void
- refund
- reversal
- transfer
- manual adjustment
- settlement posting
- escheatment posting

### 2.5 Eventual consistency for downstream operations

The following may be asynchronous:

- notifications
- webhooks
- warehouse ETL
- reports
- GL exports
- fraud analytics
- wallet pass updates
- compliance filings
- escheatment file generation

### 2.6 Idempotency everywhere

Every state-changing API request must include an idempotency key. Duplicate requests must return the original result without executing the operation again.

### 2.7 Modular monolith first

The main business application should start as a modular monolith with strict internal module boundaries. Do not start with full microservices unless required by scale, compliance, or team structure.

Extract from day one:

- Credential / Tokenization Vault
- Fraud Decisioning Engine

Extract later as needed:

- Notification workers
- Webhook workers
- Reporting workers
- GL export workers
- Compliance workers

### 2.8 Security by design

Gift cards behave like cash. Card credentials, PINs, admin access, balance checks, manual adjustments, and exports require strong controls.

---

## 3. Deployment Topology

```text
Public Internet
   │
   ├── CDN / Static Frontend Hosting
   │
   └── API Gateway / WAF / DDoS / Bot Protection
          │
          ▼
Core Platform API — Modular Monolith
          │
          ├── PostgreSQL Primary
          ├── PostgreSQL Read Replicas
          ├── Redis Cluster
          ├── Event Bus / Kafka / SQS / EventBridge
          ├── Object Storage
          ├── Search Index
          ├── Data Warehouse
          ├── Secrets Manager / Vault
          ├── Credential Vault
          └── Fraud Engine
```

Recommended network zones:

```text
Public Edge Zone
Application Zone
Credential Vault / PCI-Sensitive Zone
Data Zone
Management Zone
```

The credential vault should accept only mTLS traffic from the core platform.

---

## 4. Main Application Modules

### 4.1 Auth / IAM Module

Responsibilities:

- admin login
- SSO/SAML/OIDC
- MFA
- short-lived access tokens
- refresh-token rotation
- API keys
- API scopes
- RBAC
- tenant, brand, franchise, location, and program access
- support agent access
- auditor access
- session management

Required controls:

- MFA for all admins
- scoped roles
- audit logging for every sensitive action
- step-up authentication for sensitive exports or adjustments
- refresh token reuse detection

---

### 4.2 Tenant / Brand / Location Module

Enterprise hierarchy:

```text
Tenant
  └── Legal Entity
        └── Brand
              └── Region
                    └── Franchise Group
                          └── Location
```

Support:

- multi-brand programs
- single-brand programs
- franchisee-restricted cards
- corporate-only cards
- location-restricted promo cards
- cross-brand redemption
- store-level reporting
- region-level reporting
- legal entity accounting
- franchise settlement

---

### 4.3 Program / Campaign Module

A program defines the stored-value product.

Example programs:

- standard paid gift card
- holiday bonus card
- store credit card
- refund card
- employee reward card
- catering promo card
- corporate bulk gift card
- franchise-specific card

Program configuration:

```text
currency
minimum load
maximum load
reloadable / non-reloadable
expiration policy
dormancy policy
cash-out policy
PIN policy
allowed channels
allowed brands
allowed locations
allowed order types
partial authorization rules
refund rules
compliance rules
settlement rules
GL mapping
fraud rules
```

Campaigns define marketing-specific issuance rules.

Example:

```text
Campaign: Holiday Buy $50 Get $10
Program: Standard Gift Card
Rule:
  If paid card purchase >= $50
  Issue $10 bonus card
  Bonus card valid Jan 1 through Feb 28
  Bonus card not valid for catering
```

---

### 4.4 Card Lifecycle Module

Responsibilities:

- create card
- issue card
- activate card
- load value
- reload value
- check balance
- freeze / unfreeze
- replace lost card
- transfer balance
- close card
- suspend card
- expire card where legally allowed
- reissue card
- wallet pass linkage
- physical card inventory linkage

Important rule:

> The Card Lifecycle Module does not directly mutate balances. It requests financial postings from the Ledger Module.

---

### 4.5 Order / Checkout Module

Responsibilities:

- customer eGift purchase
- physical card purchase
- corporate bulk order
- payment authorization
- payment capture
- ACH / invoice workflow
- failed payment handling
- delayed issuance until payment approval
- refund handling
- chargeback linkage

Critical rule:

> Do not fund a paid gift card until the payment is captured, cleared, or approved under the program’s risk policy.

---

### 4.6 Redemption Module

Responsibilities:

- POS redemption
- e-commerce redemption
- mobile app redemption
- kiosk redemption
- catering order redemption
- call center redemption
- balance inquiry
- authorization
- capture
- void
- reversal
- partial approval
- split tender
- multi-card tender

Redemption flow:

```text
Redemption Request
  → Validate credential and PIN
  → Validate card status
  → Validate program rules
  → Fraud check
  → Lock card account
  → Authorize funds
  → Capture or void
  → Publish event
```

---

### 4.7 Rules / Policy Module

Responsibilities:

- load limits
- reload limits
- redemption limits
- channel restrictions
- brand restrictions
- location restrictions
- franchise restrictions
- order type restrictions
- promo start/end dates
- promo expiration
- cash-out thresholds
- dormancy rules
- refund rules
- fraud thresholds
- approval thresholds

Rules must be:

- versioned
- effective-dated
- auditable
- testable
- scoped by program, brand, location, channel, or tenant

---

### 4.8 Compliance Module

Responsibilities:

- federal gift card rules
- state gift card rules
- expiration rules
- dormancy rules
- fee disclosures
- cash-out rules
- escheatment tracking
- legal terms versioning
- cardholder acceptance tracking
- KYC triggers, where applicable
- OFAC screening, where applicable
- SAR/CTR workflow, where applicable

Compliance tiers:

| Tier | Program Type | Controls |
|---|---|---|
| Tier 1 | Closed-loop restaurant/retail gift card | expiration, fee, state cash-out, escheatment, disclosures |
| Tier 2 | Corporate bulk stored value | Tier 1 + buyer limits, approval workflow, enhanced fraud review |
| Tier 3 | Reloadable high-value closed-loop | Tier 2 + KYC triggers, enhanced velocity limits |
| Tier 4 | Open-loop prepaid/network card | Tier 3 + prepaid compliance, OFAC, AML/BSA, SAR/CTR workflows |

---

### 4.9 Settlement Module

Responsibilities:

- merchant settlement payable
- franchise settlement
- cross-brand settlement
- settlement runs
- fee withholding
- settlement approval
- ACH/wire reference tracking
- settlement reporting
- settlement reversals

Settlement hierarchy:

```text
Program Owner
  └── Brand
        └── Franchisee
              └── Location
```

---

### 4.10 Reconciliation Module

Responsibilities:

- daily card liability reconciliation
- payment clearing reconciliation
- POS reconciliation
- auth hold reconciliation
- settlement payable reconciliation
- ledger checkpoint validation
- variance detection
- finance alerts
- program suspension on critical variance

Required invariant:

```text
Program cash/float
minus payment clearing variance
minus unsettled merchant payables
should reconcile to
outstanding card liability + auth holds + promo liability + refund liability
```

---

### 4.11 Reporting Module

Operational reporting:

- card status
- card balance
- recent transactions
- bulk order status
- authorization history
- support search
- fraud queue

Analytical reporting:

- liability trends
- redemption by brand/location
- breakage cohorts
- escheatment exposure
- corporate buyer performance
- franchise settlement summaries
- campaign ROI
- fraud trends

Do not run heavy analytics directly against the primary ledger database.

---

### 4.12 Webhook Module

Responsibilities:

- webhook endpoint registration
- HMAC signing
- event delivery
- retry schedule
- dead-letter queue
- replay support
- delivery history
- endpoint disabling after repeated failure

Webhook retry schedule example:

```text
1 minute
5 minutes
30 minutes
2 hours
8 hours
24 hours
```

---

### 4.13 Notification Module

Responsibilities:

- eGift email delivery
- SMS delivery
- wallet pass update
- scheduled delivery
- resend
- bounce handling
- failed delivery alerts
- transactional templates
- corporate batch notifications
- fraud alerts
- support alerts

Notifications should consume events asynchronously.

---

## 5. Ledger Architecture

### 5.1 Core ledger tables

```text
accounts
journal_entries
journal_lines
balance_checkpoints
```

Every journal entry must balance:

```text
SUM(debits) = SUM(credits)
```

Use PostgreSQL constraint triggers or application-level transaction validation to enforce this.

### 5.2 Money representation

All money is stored as integer minor units.

Examples:

```text
5000 = $50.00 USD
7550 = $75.50 USD
```

Never use floating-point values for money.

### 5.3 Account types

Use these ledger account types:

```text
CARD_AVAILABLE_LIABILITY
CARD_AUTH_HOLD_LIABILITY
PROGRAM_CASH_OR_FLOAT
PAYMENT_CLEARING
MERCHANT_SETTLEMENT_PAYABLE
SETTLEMENT_SUSPENSE
BREAKAGE_REVENUE
FEE_INCOME
ESCHEATMENT_ESCROW
PROMOTIONAL_EXPENSE
PROMOTIONAL_LIABILITY
REFUND_CREDIT_LIABILITY
CHARGEBACK_RECEIVABLE
```

### 5.4 Journal templates

#### Paid gift card sale

```text
DR Payment Clearing / Cash              50.00
CR Card Available Liability             50.00
```

If payment processor settles later:

```text
DR Program Cash / Float                 50.00
CR Payment Clearing                     50.00
```

#### Promotional bonus issuance

```text
DR Promotional Expense                  10.00
CR Promotional Liability                10.00
```

Or, if tracked directly on a promo card account:

```text
DR Promotional Expense                  10.00
CR Card Available Liability - Promo     10.00
```

#### Authorization hold

```text
DR Card Available Liability             25.00
CR Card Authorization Hold Liability    25.00
```

#### Capture

```text
DR Card Authorization Hold Liability    25.00
CR Merchant Settlement Payable          25.00
```

#### Settlement payment

```text
DR Merchant Settlement Payable          25.00
CR Program Cash / Float                 25.00
```

#### Void before capture

```text
DR Card Authorization Hold Liability    25.00
CR Card Available Liability             25.00
```

#### Refund to card

```text
DR Refund Expense / Revenue Reversal    12.00
CR Card Available Liability             12.00
```

#### Dormancy fee, where legally allowed

```text
DR Card Available Liability              1.50
CR Fee Income                            1.50
```

#### Breakage recognition

```text
DR Card Available Liability / Liability Reserve      10.00
CR Breakage Revenue                                  10.00
```

#### Escheatment

Move eligible card value to escheatment escrow:

```text
DR Card Available Liability             20.00
CR Escheatment Escrow                   20.00
```

When remitted to state:

```text
DR Escheatment Escrow                   20.00
CR Program Cash / Float                 20.00
```

---

## 6. Balance Model

The platform has two balance concepts.

### 6.1 Accounting balance

Derived from posted journal lines.

```text
accounting balance = SUM(posted journal lines)
```

This is the finance-grade source of truth.

### 6.2 Available balance

Used for cardholder spending.

```text
available balance =
  card available liability
  minus active authorization holds
  plus eligible refunds/reloads
  minus expired promo value
```

If holds are represented in separate ledger accounts, available balance remains fully derived from ledger accounts.

### 6.3 Balance checkpoints

Balance checkpoints are allowed as read-side optimizations.

They are used for:

- high-volume balance checks
- cardholder portal balance reads
- liability reporting
- reconciliation jobs

They are never authoritative.

---

## 7. Credential / Tokenization Vault

### 7.1 Purpose

The Credential Vault stores or tokenizes sensitive card credentials.

It should support:

- closed-loop gift card numbers
- PIN credentials
- physical card number ranges
- digital card credentials
- barcode/QR secrets
- optional open-loop PANs
- optional bank account tokens for settlement

The core platform stores only:

```text
credential_token
last4
credential_type
status
metadata
```

It does not store raw credentials.

### 7.2 Vault isolation

The vault must have:

- separate service deployment
- separate database
- separate encryption keys
- separate network segment
- mTLS-only access
- HSM/KMS-backed encryption
- tamper-evident audit logs
- no raw credential logging
- strict reveal controls

### 7.3 Reveal policy

No admin should be able to reveal a full card credential.

Reveal should be allowed only for cardholder self-service when required and only with step-up authentication.

---

## 8. Authorization / Capture / Void / Reversal

Authorization states:

```text
PENDING
AUTHORIZED
PARTIALLY_CAPTURED
CAPTURED
VOIDED
EXPIRED
REVERSED
```

Rules:

- all redemptions begin with authorization
- authorization creates a hold
- capture converts hold into settlement payable
- void releases a hold
- expired authorizations are automatically voided
- reversal/refund references an original capture
- all mutation calls require idempotency keys
- concurrent redemption must lock the card account
- partial approval must be supported

---

## 9. Fraud Architecture

### 9.1 Separate fraud decisioning service

The fraud engine should be a separate low-latency service because it participates in synchronous authorization decisions.

### 9.2 Phase 1 fraud controls

Build first:

- velocity rules
- IP reputation
- failed PIN attempt tracking
- card enumeration detection
- suspicious balance-check detection
- high-value order review
- chargeback-after-redemption detection
- admin adjustment monitoring
- corporate order review
- manual fraud review queue

### 9.3 Phase 2 fraud controls

Build later:

- ML scoring
- model training pipeline
- device fingerprint graph
- chargeback feedback loop
- merchant/location anomaly detection
- risk graph analytics

Do not lead with ML. Start with deterministic rules and manual review workflows.

---

## 10. Event Architecture

Use the transactional outbox pattern.

Every financial transaction should commit the following in the same database transaction:

```text
journal_entries
journal_lines
domain state change
audit event
outbox event
```

Then workers publish outbox events to the event bus.

Required events:

```text
ledger.entries.posted
card.issued
card.activated
card.authorized
card.captured
card.voided
card.refunded
card.frozen
card.unfrozen
payment.captured
payment.failed
order.completed
bulk_order.completed
fraud.review_required
settlement.run_created
settlement.run_paid
compliance.escheatment_due
notification.requested
webhook.delivery_requested
audit.event_created
```

Kafka is appropriate for a high-volume enterprise system. For a simpler initial deployment, SQS/EventBridge can be used behind an internal event bus abstraction.

---

## 11. API Architecture

### 11.1 Public API groups

```text
/api/v1/cards
/api/v1/cards/{id}/balance
/api/v1/cards/{id}/activate
/api/v1/cards/{id}/reload
/api/v1/redemptions/authorize
/api/v1/redemptions/capture
/api/v1/redemptions/void
/api/v1/refunds
/api/v1/orders
/api/v1/bulk-orders
/api/v1/programs
/api/v1/campaigns
/api/v1/locations
/api/v1/settlements
/api/v1/reports
/api/v1/webhooks
```

### 11.2 API standards

Adopt:

- URL versioning
- request/response envelope
- cursor pagination
- idempotency on every mutation
- integer minor units for money
- rate limit headers
- structured error codes
- no floating-point money
- no raw sensitive credentials in logs

### 11.3 Example success envelope

```json
{
  "data": {},
  "meta": {
    "requestId": "req_abc123",
    "version": "2026-05-30"
  }
}
```

### 11.4 Example error envelope

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The card does not have sufficient balance for this transaction.",
    "requestId": "req_abc123",
    "details": {
      "available": 2500,
      "requested": 5000
    }
  }
}
```

---

## 12. Core Data Model

### 12.1 Financial core

```text
accounts
journal_entries
journal_lines
balance_checkpoints
authorizations
settlement_runs
settlement_lines
reconciliation_runs
gl_exports
```

### 12.2 Stored-value core

```text
cards
card_credentials
card_pins
card_status_history
card_replacements
card_transfers
card_wallet_tokens
```

### 12.3 Business model

```text
tenants
legal_entities
brands
regions
franchise_groups
locations
channels
programs
campaigns
rulesets
```

### 12.4 Commerce

```text
orders
order_items
payments
payment_events
refunds
bulk_orders
bulk_order_items
corporate_buyers
recipient_batches
```

### 12.5 Compliance

```text
terms_versions
card_terms_acceptances
cashout_requests
dormancy_assessments
escheatment_records
escheatment_filings
kyc_checks
ofac_screenings
sar_filings
ctr_filings
```

### 12.6 Fraud

```text
fraud_flags
fraud_cases
velocity_rules
device_fingerprints
risk_events
blocklists
review_queues
```

### 12.7 Operations

```text
users
roles
permissions
api_keys
webhook_endpoints
webhook_deliveries
notification_events
audit_events
support_cases
admin_approvals
```

---

## 13. Frontend Applications

### 13.1 Customer storefront

Capabilities:

- buy eGift cards
- buy physical cards
- choose design
- enter recipient
- schedule delivery
- pay online
- view receipt
- print gift card
- check balance
- register card
- reload card
- add to wallet
- report lost/stolen card

### 13.2 Admin portal

Capabilities:

- program setup
- campaign setup
- card search
- transaction history
- freezes
- replacements
- manual adjustments
- approvals
- support workflows
- fraud cases
- compliance workflows
- reporting
- settlement approval
- user management

### 13.3 Corporate buyer portal

Capabilities:

- corporate account management
- bulk order creation
- CSV upload
- recipient management
- campaign budgets
- approval workflow
- invoice/ACH/card payment
- secure card delivery
- bulk resend
- buyer reporting

### 13.4 Developer portal

Capabilities:

- API keys
- sandbox credentials
- API documentation
- webhook setup
- event replay
- test cards
- POS certification tools

---

## 14. Infrastructure Architecture

Recommended production stack:

```text
CloudFront / CDN
WAF
API Gateway or Kong / NGINX
Container runtime: ECS Fargate, EKS, or Kubernetes
PostgreSQL primary
PostgreSQL read replicas
PgBouncer
Redis Cluster
Kafka or managed event bus
S3-compatible object storage
Secrets Manager / HashiCorp Vault
KMS / HSM for sensitive keys
OpenSearch for support/admin search
Data warehouse: BigQuery, Snowflake, Redshift, or Athena
Prometheus
Grafana
Loki or centralized logging
OpenTelemetry tracing
```

Database requirements:

- PostgreSQL
- synchronous commit enabled for financial writes
- read replicas for reporting
- WAL archiving
- point-in-time recovery
- transaction-level connection pooling
- statement timeout
- lock timeout
- logical replication or CDC for warehouse

---

## 15. Security Controls

Required controls:

- MFA for admins
- RBAC and scoped permissions
- API keys with scopes
- HMAC signing for POS/partner APIs
- no full credential logging
- no admin card-number reveal
- encrypted sensitive fields
- encrypted object storage
- WAF and bot protection
- public balance-check rate limiting
- PIN lockout
- device/IP velocity rules
- immutable audit logs
- approval workflow for sensitive admin actions
- signed URLs for exports
- short-lived access tokens
- refresh-token rotation
- SIEM/security event feed

Sensitive actions requiring approval:

```text
large balance adjustment
bulk card issuance
manual card funding
refund above threshold
export of card file
settlement approval
program suspension release
fraud blocklist override
```

---

## 16. Reporting and Warehouse

### 16.1 Operational reports

Served from read replica or read model:

- current balance
- card status
- recent transactions
- authorization history
- bulk order status
- support search
- fraud queue

### 16.2 Analytical reports

Served from warehouse:

- liability trends
- breakage cohorts
- redemption by brand/location
- corporate buyer performance
- franchise settlement summaries
- fraud patterns
- escheatment exposure
- campaign ROI

Warehouse ingestion options:

- Debezium CDC
- outbox event consumers
- Kafka Connect
- S3 Parquet data lake
- Athena / Snowflake / BigQuery / Redshift

---

## 17. Observability

### 17.1 Logs

Every log should be structured JSON.

Required fields:

```text
timestamp
level
service
version
requestId
userId
programId
method
path
statusCode
durationMs
message
entity ids
```

Never log:

```text
PANs
full card numbers
PINs
passwords
API keys
SSNs
bank account numbers
raw auth request bodies
```

### 17.2 Metrics

Business metrics:

```text
gift_card_authorizations_total
gift_card_authorization_amount_cents
gift_card_balance_total_cents
gift_card_float_variance_cents
gift_card_fraud_flags_total
gift_card_escheatment_amount_cents
```

Technical metrics:

```text
http_request_duration_seconds
db_query_duration_seconds
event_consumer_lag
redis_command_duration_seconds
fraud_engine_latency_seconds
vault_request_duration_seconds
```

### 17.3 Alerts

Critical alerts:

- reconciliation variance above threshold
- authorization success rate drop
- fraud flag spike
- float below threshold
- OFAC match
- DB replication lag
- event consumer lag
- vault error rate spike
- suspicious export activity

---

## 18. Implementation Roadmap

### Phase 1 — Foundation

Build:

```text
PostgreSQL schema
accounts
journal_entries
journal_lines
balance calculation
idempotency middleware
audit log
credential vault
admin auth
programs
cards
basic issuance
basic balance check
```

Exit criterion:

```text
A card can be issued, loaded, queried, and audited using only ledger-derived balance.
```

---

### Phase 2 — Redemption Core

Build:

```text
authorization
capture
void
reversal
partial approval
PIN validation
POS API
online ordering API
expired authorization sweeper
card locking
fraud velocity checks
```

Exit criterion:

```text
A POS or e-commerce system can redeem a card safely with no double-spend risk.
```

---

### Phase 3 — Commerce and Delivery

Build:

```text
customer storefront
eGift purchase
payment integration
email/SMS delivery
scheduled delivery
card designs
receipt flow
resend flow
refund-to-card
```

Exit criterion:

```text
Customers can buy and receive digital gift cards end to end.
```

---

### Phase 4 — Enterprise Operations

Build:

```text
admin portal
support console
corporate buyer portal
bulk issuance
physical card inventory
card replacement
freeze/unfreeze
manual adjustments
approval workflows
webhooks
sandbox environment
```

Exit criterion:

```text
The platform supports enterprise users, support agents, and corporate buyers.
```

---

### Phase 5 — Finance and Compliance

Build:

```text
daily reconciliation
liability reporting
GL exports
settlement runs
franchise settlement
breakage jobs
escheatment records
cash-out workflow
terms/disclosure versioning
```

Exit criterion:

```text
Finance can close the month from the platform reports.
```

---

### Phase 6 — Scale and Risk

Build:

```text
advanced fraud engine
device fingerprinting
ML model pipeline
warehouse ETL
advanced observability
SIEM integration
load testing
DR testing
SOC 2 evidence collection
PCI/QSA review if open-loop or payment-card PANs are handled
```

Exit criterion:

```text
The system is ready for high-volume enterprise production.
```

---

## 19. Prompt-Building Guidance

When using this architecture to create future prompts, instruct the builder to:

1. Treat the ledger as the source of truth.
2. Never store authoritative balances as mutable card fields.
3. Use double-entry accounting for every financial operation.
4. Use integer minor units for all money.
5. Require idempotency keys for every mutation.
6. Use a credential vault for card credentials and PINs.
7. Keep fraud decisioning separate from the main API.
8. Use the transactional outbox pattern for events.
9. Use PostgreSQL for the ledger.
10. Use Redis only for cache, rate limits, sessions, and velocity checks — not as the financial source of truth.
11. Use async workers for notifications, webhooks, reports, GL exports, and compliance jobs.
12. Implement admin RBAC, MFA, audit logging, and approval workflows before production use.
13. Implement reconciliation before scaling issuance volume.
14. Keep compliance features configurable by program risk tier.
15. Design the system so a closed-loop restaurant gift card can launch first, while open-loop/high-value stored-value programs can be added later.

---

## 20. Recommended Prompt Header for Future Codex Tasks

Use this at the top of future development prompts:

```text
You are building an enterprise production-grade gift card and stored-value platform. The system must be ledger-first, using a double-entry accounting model with accounts, journal_entries, journal_lines, and derived balances. No mutable balance field may be the financial source of truth. All money must use integer minor units. Every state-changing API must require idempotency. Sensitive card credentials must be stored only in a separate credential/tokenization vault. The core application should be implemented as a modular monolith with strict bounded contexts, while the credential vault and fraud decisioning engine are separate services. Use event-driven workers with a transactional outbox for notifications, webhooks, reporting, reconciliation, GL export, and compliance workflows.
```

---

## 21. Final Architecture Rule

The system should be built around this invariant:

```text
Only the ledger changes stored value.
Everything else requests, validates, reports, settles, notifies, or reacts.
```

That rule is the foundation of a production-grade enterprise gift card platform.
