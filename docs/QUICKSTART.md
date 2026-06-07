# GiftCard Platform — Quick Start

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 22.0.0 |
| npm | ≥ 10.0.0 |
| Docker + Docker Compose | ≥ 24 |
| OpenSSL | any recent |

---

## 1. Clone and install

```bash
git clone <repo-url>
cd gift-card-platform
npm install          # installs all workspaces
```

---

## 2. Generate RS256 key pair

The API uses RS256 JWTs. Generate a key pair once and keep it out of version control.

```bash
# In the repo root (or use a secrets manager in production)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

---

## 3. Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in at minimum:

| Variable | Value |
|----------|-------|
| `JWT_PRIVATE_KEY` | Contents of `private.pem` (single-line, `\n` escaped) |
| `JWT_PUBLIC_KEY` | Contents of `public.pem` (single-line, `\n` escaped) |
| `ENCRYPTION_KEY` | 64 hex chars — run `openssl rand -hex 32` |
| `VAULT_ENCRYPTION_KEY` | 64 hex chars — run `openssl rand -hex 32` |
| `VAULT_TOKENIZATION_SECRET` | Any long random string |
| `STRIPE_SECRET_KEY` | Your Stripe test key (`sk_test_…`) |

To inline a PEM file as a single line:
```bash
# macOS / Linux
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem
```

---

## 4. Start infrastructure with Docker Compose

```bash
# Start all backing services + application services
docker compose up -d

# Or just the infrastructure (postgres, redis, kafka, vault, fraud)
docker compose up -d postgres postgres_vault redis kafka vault fraud
```

### Service ports

| Service | Port | Notes |
|---------|------|-------|
| Core API | 4000 | REST API |
| Metrics | 9090 | Prometheus `/metrics` |
| Vault | 4001 | Internal only — PCI isolated |
| Fraud Engine | 4002 | Internal only |
| Admin SPA | 3000 | React frontend |
| Cardholder Portal | 3001 | React frontend |
| PostgreSQL (API) | 5432 | |
| PostgreSQL (Vault) | 5433 | |
| Redis | 6379 | |
| Kafka | 9092 | |

### Optional nginx gateway (all services behind one host)
```bash
docker compose --profile gateway up -d nginx
# Admin:      http://localhost:80
# Cardholder: http://localhost:8080
# API direct: http://localhost:8090
```

---

## 5. Initialize the database

The API Dockerfile runs `prisma db push` on startup, which creates all tables from `schema.prisma`.

For local development without Docker:

```bash
# Create the main API database
npm run db:migrate -w services/api      # deploys any migration files
# OR for a fresh setup with no migration files:
npx prisma db push --schema services/api/src/prisma/schema.prisma

# Seed initial data (creates SUPER_ADMIN user + example program)
npm run db:seed -w services/api
```

For the vault database:
```bash
npx prisma db push --schema services/vault/src/schema.prisma
```

---

## 6. Generate Prisma migrations (first time)

After making schema changes, generate a migration:

```bash
cd services/api
npx prisma migrate dev --name <description>
# e.g. npx prisma migrate dev --name init
```

Commit the generated `src/prisma/migrations/` files. The Dockerfile runs
`prisma migrate deploy` in production (swap `db push` → `migrate deploy` in the CMD).

---

## 7. Run in development mode

```bash
# All services with hot-reload
npm run dev

# API services only (no frontends)
npm run dev:api

# Frontends only (expects API already running)
npm run dev:fe
```

---

## 8. Run tests

```bash
npm run test                # vitest run (once)
npm run test:coverage       # vitest with coverage report
```

Coverage reports land in `services/api/coverage/`.

---

## 9. First login (after seeding)

The seed creates:
- **SUPER_ADMIN**: `admin@giftcards.example.com` / `Admin1234!`
- **PROGRAM_ADMIN**: `progadmin@giftcards.example.com` / `Admin1234!`
- **Program**: `demo-corporate` (USD, $100k budget cap, 5-year card expiry)

Admin SPA: http://localhost:3000  
Cardholder Portal: http://localhost:3001

---

## Architecture overview

```
Browser (Admin)          Browser (Cardholder)
     │                          │
     ▼ :3000                    ▼ :3001
┌─────────┐              ┌────────────┐
│  Admin  │              │ Cardholder │
│   SPA   │              │   Portal   │
└────┬────┘              └─────┬──────┘
     │ /api/*                  │ /api/*
     ▼                         ▼
┌──────────────────────────────────────┐
│           Core API  :4000            │
│  (Express + Prisma + BullMQ)         │
└──┬──────────┬──────────┬────────────┘
   │          │          │
   ▼          ▼          ▼
Vault      Fraud      Kafka
:4001      :4002      :9092
(PCI       (Redis      │
 isolated)  scoring)   ▼
            │       Worker
            │     (BullMQ)
            ▼
         Redis
         :6379
```

See `docs/platform-architecture.md` for full detail.

---

## Troubleshooting

**`JWT_PRIVATE_KEY` env validation fails**  
The PEM must include `-----BEGIN RSA PRIVATE KEY-----` header/footer with `\n` characters.
Use the `awk` command above to inline it.

**`ENCRYPTION_KEY must be 64 hex characters`**  
Run `openssl rand -hex 32` — do not use the placeholder from `.env.example`.

**Prisma: `Table X does not exist`**  
Run `npx prisma db push` against the correct `DATABASE_URL`.

**Kafka `LEADER_NOT_AVAILABLE`**  
Wait ~15s after starting Kafka before starting the API. The healthcheck in
`docker-compose.yml` handles this automatically when using `docker compose up`.

**Port 80 already in use (nginx profile)**  
The nginx gateway is optional (`--profile gateway`). The frontends at :3000/:3001
work fine without it.
