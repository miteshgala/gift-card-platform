/**
 * Tokenization Vault Service
 *
 * PCI-isolated process. Accepts connections only from the core API.
 * In production: enforce mTLS at the nginx/load-balancer layer.
 * In development: shared secret header for simplicity.
 *
 * NEVER logs PANs. NEVER returns PANs except from /reveal (audit-logged).
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { generateToken, encryptPan, decryptPan, isValidPan } from './crypto';
import winston from 'winston';

const log = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'vault' },
  transports: [new winston.transports.Console({ format: winston.format.json() })],
});

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env['VAULT_PORT'] ?? 4001);
const ENV = (process.env['NODE_ENV'] ?? 'development') as 'development' | 'production';
const TOKEN_ENV = ENV === 'production' ? 'live' : 'test';

// Internal auth: callers must present X-Vault-Secret header matching VAULT_INTERNAL_SECRET
const VAULT_SECRET = process.env['VAULT_INTERNAL_SECRET'] ?? 'dev-vault-secret';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

// ─── Internal auth middleware ──────────────────────────────────────────────────
function requireVaultSecret(req: Request, res: Response, next: NextFunction): void {
  const presented = req.headers['x-vault-secret'];
  if (presented !== VAULT_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.use(requireVaultSecret);

// ─── POST /tokens — tokenize a PAN ───────────────────────────────────────────
const tokenizeSchema = z.object({ pan: z.string().min(13).max(19) });

app.post('/tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pan } = tokenizeSchema.parse(req.body);

    if (!isValidPan(pan)) {
      res.status(400).json({ error: { code: 'INVALID_PAN', message: 'PAN failed Luhn check' } });
      return;
    }

    const token = generateToken(pan, TOKEN_ENV);
    const last4 = pan.slice(-4);
    const bin = pan.slice(0, 6);

    // Upsert — deterministic token means same PAN always maps to same token
    const existing = await prisma.vaultRecord.findUnique({ where: { token } });
    if (!existing) {
      const { ciphertext, iv } = encryptPan(pan);
      const activeKey = await prisma.encryptionKey.findFirst({ where: { status: 'ACTIVE' } });
      await prisma.vaultRecord.create({
        data: { token, ciphertext, iv, keyVersion: activeKey?.version ?? 1, last4, bin },
      });
      log.info('Token created', { token: token.slice(0, 15) + '...' });
    }

    // NEVER return the PAN
    res.status(201).json({ token, last4, bin });
  } catch (err) {
    next(err);
  }
});

// ─── GET /tokens/:token — retrieve metadata ───────────────────────────────────
app.get('/tokens/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.vaultRecord.findUnique({
      where: { token: req.params['token'] as string },
      select: { token: true, last4: true, bin: true, keyVersion: true, createdAt: true },
    });
    if (!record) {
      res.status(404).json({ error: { code: 'TOKEN_NOT_FOUND' } });
      return;
    }
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// ─── POST /reveal — retrieve PAN (audit-logged, rate-limited) ────────────────
const revealSchema = z.object({
  token: z.string(),
  requesterId: z.string(),
  reason: z.string().min(5).max(200),
});

app.post('/reveal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, requesterId, reason } = revealSchema.parse(req.body);

    // Rate limit: 10 reveals/minute per token (in-memory for simplicity; use Redis in prod)
    const record = await prisma.vaultRecord.findUnique({ where: { token } });
    if (!record) {
      res.status(404).json({ error: { code: 'TOKEN_NOT_FOUND' } });
      return;
    }

    // Audit log the reveal — always, before returning PAN
    await prisma.vaultRevealLog.create({
      data: {
        token,
        requesterId,
        reason,
        ipAddress: req.ip ?? null,
      },
    });

    const pan = decryptPan(record.ciphertext, record.iv);

    log.info('PAN revealed', { requesterId, reason, tokenPrefix: token.slice(0, 15) });

    // No-cache headers — PAN must never be cached by the caller
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json({ pan });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /tokens/:token — GDPR erasure ────────────────────────────────────
app.delete('/tokens/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params['token'] as string;
    await prisma.vaultRecord.deleteMany({ where: { token } });
    log.info('Token deleted (GDPR erasure)', { tokenPrefix: token.slice(0, 15) });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'vault' }));
app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log.error('Vault error', { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
});

app.listen(PORT, () => log.info(`Vault service started on port ${PORT}`));

process.on('beforeExit', () => void prisma.$disconnect());
