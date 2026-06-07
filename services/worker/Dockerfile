# Worker Dockerfile — root build context (.)
# Uses tsx to run the scheduler directly against api's shared modules.

# ─── Stage 1: API Dependencies ────────────────────────────────────────────────
FROM node:22-alpine AS api-deps
WORKDIR /workspace/services/api
COPY services/api/package.json services/api/package-lock.json* ./
RUN npm ci --ignore-scripts

# ─── Stage 2: Build API ────────────────────────────────────────────────────────
FROM node:22-alpine AS api-builder
WORKDIR /workspace
COPY services/api ./services/api
COPY --from=api-deps /workspace/services/api/node_modules ./services/api/node_modules
# Generate Prisma client — needed at runtime too
RUN cd services/api && npx prisma generate && npx tsc -p tsconfig.json

# ─── Stage 3: Worker Dependencies ─────────────────────────────────────────────
FROM node:22-alpine AS worker-deps
WORKDIR /workspace/services/worker
COPY services/worker/package.json ./
# Include tsx as a local dep so the runner stage can use it
RUN npm install --ignore-scripts

# ─── Stage 4: Production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /workspace

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy compiled API (for shared modules imported dynamically)
COPY --from=api-builder --chown=nodejs:nodejs /workspace/services/api/dist ./services/api/dist
COPY --from=api-builder --chown=nodejs:nodejs /workspace/services/api/node_modules ./services/api/node_modules
COPY --from=api-builder --chown=nodejs:nodejs /workspace/services/api/src/prisma/schema.prisma ./services/api/src/prisma/schema.prisma
COPY --from=api-builder --chown=nodejs:nodejs /workspace/services/api/package.json ./services/api/package.json

# Copy worker source + its node_modules (tsx is here)
COPY --chown=nodejs:nodejs services/worker/src ./services/worker/src
COPY --chown=nodejs:nodejs services/worker/package.json ./services/worker/package.json
COPY --from=worker-deps /workspace/services/worker/node_modules ./services/worker/node_modules

USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "scheduler" || exit 1

CMD ["./services/worker/node_modules/.bin/tsx", "services/worker/src/scheduler.ts"]
