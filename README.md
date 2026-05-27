# Enterprise Gift Card Management Platform

A production-grade, full-stack gift card management system built with Node.js, React, PostgreSQL, and Redis.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Gift Card Platform                       │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  React Admin │    │ Customer     │    │ Third-party  │ │
│  │  Dashboard   │    │ Self-service │    │ API Clients  │ │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘ │
│         │                   │                    │          │
│  ┌──────▼───────────────────▼────────────────────▼───────┐ │
│  │              Express REST API  (/api/v1)               │ │
│  │                                                         │ │
│  │  Auth  │ Cards │ Ledger │ Fraud │ Orders │ Reports      │ │
│  └──────────────────────────┬────────────────────────────┘ │
│                             │                               │
│  ┌──────────────────────────▼────────────────────────────┐ │
│  │  PostgreSQL (Prisma ORM)    Redis (Bull Queue)          │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, React Query, React Router |
| Backend | Node.js 20, Express, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7, Bull |
| Auth | JWT (access 15m + refresh 7d), bcrypt |
| Testing | Vitest, Supertest |
| API Docs | Swagger/OpenAPI 3.0 |
| Containers | Docker + Docker Compose |

---

## Quick Start

### Prerequisites

- Docker Desktop
- Node.js 20+
- npm 10+

### 1. Clone and configure

```bash
cd gift-card-platform
cp .env.example .env
# Edit .env with your secrets (especially JWT_SECRET, ENCRYPTION_KEY)
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

Services:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Swagger UI**: http://localhost:4000/api-docs
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

### 3. Run migrations and seed

```bash
docker compose exec backend npx prisma migrate dev
docker compose exec backend npm run db:seed
```

Default credentials after seeding:
- Super Admin: `admin@giftcards.example.com` / `Admin1234!`
- Program Admin: `progadmin@giftcards.example.com` / `Admin1234!`

---

## Local Development (without Docker)

### Backend

```bash
cd backend
cp ../.env.example .env          # Configure your local .env
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev                      # Starts on port 4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                      # Starts on port 3000
```

### Run Tests

```bash
cd backend
npm test                         # Run all tests with coverage
npm run test:watch               # Watch mode
```

---

## API Reference

### Authentication

All protected endpoints require a `Bearer` token:

```http
Authorization: Bearer <access_token>
```

Third-party integrations use API keys:

```http
x-api-key: sk_live_your_key_here
```

### Core Endpoints

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/register | Register new user |
| POST | /api/v1/auth/login | Login → access + refresh tokens |
| POST | /api/v1/auth/refresh | Rotate refresh token |
| POST | /api/v1/auth/logout | Revoke refresh token |
| GET  | /api/v1/auth/me | Current user info |

#### Gift Cards

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/cards | Issue a single card |
| GET  | /api/v1/cards | List cards (filterable) |
| GET  | /api/v1/cards/:id | Get card details |
| POST | /api/v1/cards/:id/freeze | Freeze card |
| POST | /api/v1/cards/:id/unfreeze | Unfreeze card |
| POST | /api/v1/cards/:id/cancel | Cancel card |

#### Ledger

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/ledger/balance-check | Public balance check (card# + PIN) |
| POST | /api/v1/ledger/redeem | Redeem against card |
| POST | /api/v1/ledger/cards/:id/load | Load funds onto card |
| POST | /api/v1/ledger/cards/:id/refund | Refund to card |
| POST | /api/v1/ledger/cards/:id/adjust | Manual adjustment |
| GET  | /api/v1/ledger/cards/:id/balance | Get balance |
| GET  | /api/v1/ledger/cards/:id/transactions | Transaction history |

#### Orders (Bulk Issuance)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/orders | Create bulk order |
| POST | /api/v1/orders/bulk-csv | Upload CSV for bulk order |
| GET  | /api/v1/orders | List orders |
| GET  | /api/v1/orders/:id | Get order details |
| GET  | /api/v1/orders/:id/status | Job progress |
| POST | /api/v1/orders/:id/approve | Approve pending order |

#### Reports (requires Finance role or above)

| Method | Path | Query Params |
|--------|------|-------------|
| GET | /api/v1/reports/liability | programId, format |
| GET | /api/v1/reports/breakage | programId, from, to, format |
| GET | /api/v1/reports/redemption-rate | programId, from, to, format |
| GET | /api/v1/reports/transaction-volume | programId, from, to |
| GET | /api/v1/reports/escheatment | programId, dormantDays, format |

All report endpoints support `format=json|csv|pdf`.

### Example: Issue and redeem a card

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"progadmin@giftcards.example.com","password":"Admin1234!"}' \
  | jq -r '.data.accessToken')

# 2. Issue a $50 eGift card
CARD=$(curl -s -X POST http://localhost:4000/api/v1/cards \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "programId": "<your-program-id>",
    "cardType": "DIGITAL",
    "initialBalance": 50,
    "recipientEmail": "customer@example.com"
  }')

CARD_NUMBER=$(echo $CARD | jq -r '.data.cardNumber')
CARD_PIN=$(echo $CARD | jq -r '.data.pin')

# 3. Check balance
curl -s -X POST http://localhost:4000/api/v1/ledger/balance-check \
  -H 'Content-Type: application/json' \
  -d "{\"cardNumber\":\"$CARD_NUMBER\",\"pin\":\"$CARD_PIN\"}"

# 4. Redeem $25
curl -s -X POST http://localhost:4000/api/v1/ledger/redeem \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"cardNumber\":\"$CARD_NUMBER\",\"pin\":\"$CARD_PIN\",\"amount\":25,\"description\":\"Purchase at store\"}"
```

---

## Bulk Issuance CSV Format

Upload a CSV with the following columns:

```csv
email,name,denomination
alice@example.com,Alice Smith,50
bob@example.com,Bob Jones,100
carol@example.com,Carol White,75
```

---

## Security

- **Card numbers**: HMAC-SHA256 hashed at rest (deterministic for lookup)
- **PINs**: bcrypt-hashed (slow hash, resistant to brute force)
- **Refresh tokens**: SHA-256 hashed at rest; rotated on every use
- **API keys**: HMAC-SHA256 hashed; prefix shown for identification
- **Sensitive fields** never appear in application logs
- **Rate limiting**: 100 req/min globally, 20 req/15min on auth endpoints
- **PIN lockout**: 5 failed attempts → 24-hour lockout
- **RBAC**: Six roles with granular permission enforcement at route level
- **Audit log**: Every auth event and data mutation is recorded

## Roles

| Role | Permissions |
|------|------------|
| SUPER_ADMIN | Full access including program management |
| PROGRAM_ADMIN | Manage their program (users, campaigns, orders) |
| FINANCE | Reports, loads, refunds, adjustments |
| MARKETING | Issue cards, create campaigns, manage orders |
| SUPPORT | Card freeze/unfreeze, view fraud flags |
| READ_ONLY | View-only access |

---

## Project Structure

```
gift-card-platform/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # Database schema (all entities)
│   ├── src/
│   │   ├── config/                # env, logger, prisma, redis
│   │   ├── middleware/            # errorHandler, validate, rateLimiter
│   │   ├── modules/
│   │   │   ├── auth/              # JWT, RBAC, refresh tokens
│   │   │   ├── cards/             # Issuance, freeze, cancel
│   │   │   ├── ledger/            # Load, redeem, refund, balance
│   │   │   ├── fraud/             # Velocity rules, flags, geo
│   │   │   ├── orders/            # Bulk orders, approval workflow
│   │   │   ├── programs/          # Tenants, campaigns, departments
│   │   │   ├── webhooks/          # Endpoints, delivery, API keys
│   │   │   ├── reports/           # Liability, breakage, escheatment
│   │   │   ├── users/             # User management, audit log
│   │   │   └── email/             # eGift email templates
│   │   ├── queues/
│   │   │   └── issuance.queue.ts  # Bull queue for bulk issuance
│   │   ├── types/                 # Shared TypeScript types
│   │   ├── utils/                 # crypto, response, pagination
│   │   ├── tests/                 # Vitest tests (ledger, fraud, crypto)
│   │   ├── app.ts                 # Express app + routes
│   │   └── index.ts               # Server entry point
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/layout/     # AdminLayout, PublicLayout
│   │   ├── hooks/                 # useAuth
│   │   ├── lib/                   # axios client, token management
│   │   ├── pages/
│   │   │   ├── admin/             # Dashboard, Cards, Orders, Reports...
│   │   │   └── customer/          # BalanceCheck, RegisterCard
│   │   ├── store/                 # Zustand auth store
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Environment Variables

See `.env.example` for all required variables. Critical ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | ≥32 char secret for access tokens |
| `JWT_REFRESH_SECRET` | ≥32 char secret for refresh tokens |
| `ENCRYPTION_KEY` | Exactly 32 chars, for AES-256 encryption |
| `SMTP_*` | Email delivery settings |

---

## Testing

```bash
cd backend
npm test                  # Run with coverage report
npm run test:watch        # Watch mode for development
```

Coverage targets: **80%+ on ledger, fraud, and crypto modules**

Test files:
- `src/tests/ledger.test.ts` — Full load/redeem/refund/adjust coverage
- `src/tests/fraud.test.ts` — Velocity checks, geolocation, flag CRUD
- `src/tests/crypto.test.ts` — Card number gen, PIN hashing, encryption

---

## Webhooks

Register an endpoint to receive real-time events:

```bash
curl -X POST http://localhost:4000/api/v1/integrations/endpoints \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "programId": "<program-id>",
    "url": "https://your-server.example.com/webhooks/giftcard",
    "events": ["CARD_ISSUED", "CARD_REDEEMED", "FRAUD_FLAGGED"]
  }'
```

Payload is HMAC-SHA256 signed with the `t=<timestamp>,v1=<signature>` header format (compatible with Stripe-style verification).

---

## License

MIT
