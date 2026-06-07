# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install only production dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client before TypeScript build
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy Prisma files needed at runtime
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/src/prisma/schema.prisma ./src/prisma/schema.prisma
COPY --chown=nodejs:nodejs package.json ./

# Install Prisma CLI for migrations
RUN npm install --no-save prisma

USER nodejs

EXPOSE 4000 9090

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:4000/health/live || exit 1

# db push: idempotent schema sync — works on a fresh DB (no migration files needed)
# and on an existing DB (no-ops if schema matches). For production with a migration
# history, swap this for: npx prisma migrate deploy --schema src/prisma/schema.prisma
CMD ["sh", "-c", "npx prisma db push --schema src/prisma/schema.prisma --accept-data-loss && node dist/app.js"]
