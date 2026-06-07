# Vault Dockerfile — PCI-isolated tokenization service

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client for vault DB
RUN npx prisma generate
RUN npm run build

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json ./

# Prisma schema needed for migrations
COPY --from=builder --chown=nodejs:nodejs /app/src/schema.prisma ./src/schema.prisma

RUN npm install --no-save prisma

USER nodejs

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:4001/health/live || exit 1

CMD ["sh", "-c", "npx prisma db push --schema src/schema.prisma --accept-data-loss && node dist/app.js"]
