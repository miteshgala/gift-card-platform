# ─────────────────────────────────────────────────────────────────────────────
# GiftCard Platform — Makefile
#
# Provides one-command shortcuts for common developer tasks.
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help install dev dev-api dev-fe \
        build build-api build-fe \
        test test-watch test-coverage \
        db-push db-seed db-studio \
        docker-up docker-down docker-logs docker-reset \
        keys lint clean

# ── Default target ────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  GiftCard Platform — Make targets"
	@echo ""
	@echo "  Setup"
	@echo "    make install       Install all workspace dependencies"
	@echo "    make keys          Generate RS256 key pair (private.pem + public.pem)"
	@echo ""
	@echo "  Development"
	@echo "    make dev           Run all services with hot-reload"
	@echo "    make dev-api       Run backend services only (api, vault, fraud, worker)"
	@echo "    make dev-fe        Run frontend devservers only (admin :3000, ch :3001)"
	@echo ""
	@echo "  Build"
	@echo "    make build         Build all services and frontends"
	@echo "    make build-api     Build backend services only"
	@echo "    make build-fe      Build frontend SPAs only"
	@echo ""
	@echo "  Testing"
	@echo "    make test          Run vitest once"
	@echo "    make test-watch    Run vitest in watch mode"
	@echo "    make test-coverage Run vitest with coverage report"
	@echo ""
	@echo "  Database"
	@echo "    make db-push       Push Prisma schema to database (dev)"
	@echo "    make db-seed       Seed demo data"
	@echo "    make db-studio     Open Prisma Studio"
	@echo ""
	@echo "  Docker"
	@echo "    make docker-up     Build and start all containers"
	@echo "    make docker-down   Stop all containers"
	@echo "    make docker-logs   Tail container logs"
	@echo "    make docker-reset  Destroy all containers + volumes (WARNING: data loss)"
	@echo ""
	@echo "  Misc"
	@echo "    make clean         Delete all dist/ and coverage/ directories"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
install:
	npm install

keys:
	@echo "Generating RS256 key pair..."
	openssl genrsa -out private.pem 2048
	openssl rsa -in private.pem -pubout -out public.pem
	@echo ""
	@echo "✅  private.pem and public.pem created."
	@echo "    Add to .env.local as single-line values:"
	@echo ""
	@echo "    JWT_PRIVATE_KEY=\"$$(awk 'NF {sub(/\r/, ""); printf "%s\\\\n",$$0;}' private.pem)\""
	@echo "    JWT_PUBLIC_KEY=\"$$(awk 'NF {sub(/\r/, ""); printf "%s\\\\n",$$0;}' public.pem)\""
	@echo ""
	@echo "    ⚠️  private.pem is gitignored. Back it up securely."

# ── Development ───────────────────────────────────────────────────────────────
dev:
	npm run dev

dev-api:
	npm run dev:api

dev-fe:
	npm run dev:fe

# ── Build ─────────────────────────────────────────────────────────────────────
build:
	npm run build

build-api:
	npm run build:api

build-fe:
	npm run build:fe

# ── Testing ───────────────────────────────────────────────────────────────────
test:
	npm run test

test-watch:
	npm run test:watch -w services/api

test-coverage:
	npm run test:coverage

# ── Database ──────────────────────────────────────────────────────────────────
db-push:
	npm run db:push -w services/api

db-seed:
	npm run db:seed -w services/api

db-studio:
	npm run db:studio -w services/api

# ── Docker ────────────────────────────────────────────────────────────────────
docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-reset:
	@echo "⚠️  This will destroy ALL containers and volumes (all data lost)."
	@read -p "Type 'yes' to confirm: " confirm; \
	  if [ "$$confirm" = "yes" ]; then \
	    docker compose down -v --remove-orphans; \
	    echo "Done."; \
	  else \
	    echo "Aborted."; \
	  fi

# ── Misc ──────────────────────────────────────────────────────────────────────
clean:
	find . -type d -name dist -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name coverage -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true
	@echo "✅  Cleaned dist/, coverage/, and *.tsbuildinfo"
