# ─── Base ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ─── Development ──────────────────────────────────────────────────────────────
FROM base AS development
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ─── Builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Production ───────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/index.js"]
