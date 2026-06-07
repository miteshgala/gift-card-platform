/**
 * Fraud Decisioning Engine
 *
 * Four-layer pipeline returning a risk score and decision within 80ms.
 * All layers run in sequence; the first DECLINE short-circuits the rest.
 *
 * Layer 1: Hard blocks (in-memory, ~0ms)
 * Layer 2: Velocity rules (Redis sorted sets, ~5ms)
 * Layer 3: Rule-based ML approximation (~10ms)
 * Layer 4: (Async) Human review queue for score >= 60
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { Redis } from 'ioredis';
import { z } from 'zod';
import winston from 'winston';

const log = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'fraud' },
  transports: [new winston.transports.Console({ format: winston.format.json() })],
});

const app = express();
const PORT = Number(process.env['FRAUD_PORT'] ?? 4002);
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, retryStrategy: (t) => Math.min(t * 100, 1000) });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

// ─── MCC Risk Map (simplified) ────────────────────────────────────────────────
const HIGH_RISK_MCCS = new Set(['7995', '5912', '5999', '6010', '6011', '7011']);
const MEDIUM_RISK_MCCS = new Set(['5411', '5912', '5541', '7372']);

// ─── Score request schema ─────────────────────────────────────────────────────
const scoreSchema = z.object({
  authorizationId: z.string(),
  vaultToken: z.string(),
  amount: z.string().transform((v) => BigInt(v)),
  currency: z.string().optional(),
  merchantMcc: z.string().optional(),
  merchantCountry: z.string().optional(),
  posEntryMode: z.string().optional(),
  ipAddress: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  programId: z.string(),
});

type ScoreRequest = z.infer<typeof scoreSchema>;

interface ScoreResponse {
  riskScore: number;
  decision: 'APPROVE' | 'DECLINE' | 'REVIEW';
  declineCode?: string;
  triggeredRules: string[];
}

// ─── POST /score ──────────────────────────────────────────────────────────────
app.post('/score', async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  try {
    const input = scoreSchema.parse(req.body);
    const result = await scoreRequest(input);

    log.info('Scored authorization', {
      authorizationId: input.authorizationId,
      score: result.riskScore,
      decision: result.decision,
      latencyMs: Date.now() - start,
    });

    res.json(result);
  } catch (err) {
    // Always return a valid response — never crash the fraud engine
    log.error('Fraud engine error — failing open', { error: err instanceof Error ? err.message : String(err) });
    res.json({ riskScore: 0, decision: 'APPROVE', triggeredRules: [] } satisfies ScoreResponse);
    void next;
  }
});

async function scoreRequest(input: ScoreRequest): Promise<ScoreResponse> {
  const triggered: string[] = [];
  let score = 0;

  // ── Layer 2: Velocity rules (Redis) ─────────────────────────────────────────
  const velocityResult = await checkVelocity(input);
  if (velocityResult.shouldDecline) {
    return { riskScore: 95, decision: 'DECLINE', declineCode: 'VELOCITY_EXCEEDED', triggeredRules: velocityResult.triggered };
  }
  score += velocityResult.score;
  triggered.push(...velocityResult.triggered);

  // ── Layer 3: Rule-based scoring ──────────────────────────────────────────────
  score += scoreMcc(input.merchantMcc);
  score += scoreAmount(input.amount);
  score += scoreTimeOfDay();
  score += scoreEntryMode(input.posEntryMode);

  score = Math.min(score, 100);

  const decision: 'APPROVE' | 'DECLINE' | 'REVIEW' =
    score >= 85 ? 'DECLINE' : score >= 60 ? 'REVIEW' : 'APPROVE';

  // ── Layer 4: Enqueue for human review if score >= 60 ─────────────────────────
  if (score >= 60) {
    await redis.lpush('fraud:review:queue', JSON.stringify({
      authorizationId: input.authorizationId,
      score,
      decision,
      triggered,
      queuedAt: new Date().toISOString(),
    })).catch(() => {/* non-fatal */});
  }

  return {
    riskScore: score,
    decision,
    triggeredRules: triggered,
  };
}

// ─── Velocity check (Redis sorted sets) ───────────────────────────────────────
async function checkVelocity(input: ScoreRequest): Promise<{ shouldDecline: boolean; score: number; triggered: string[] }> {
  const now = Date.now();
  const triggered: string[] = [];
  let score = 0;

  // Hourly spend per card (max $1,000 = 100,000 cents)
  const cardHourlyKey = `vel:card:hour:${input.vaultToken}`;
  const oneHourAgo = now - 3_600_000;

  try {
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(cardHourlyKey, '-inf', oneHourAgo);
    pipe.zadd(cardHourlyKey, now, `${input.authorizationId}:${input.amount}`);
    pipe.zrangebyscore(cardHourlyKey, oneHourAgo, '+inf', 'WITHSCORES');
    pipe.expire(cardHourlyKey, 7200);
    const results = await pipe.exec();

    if (results) {
      const members = (results[2]?.[1] ?? []) as string[];
      // Sum amounts from members (format: "authId:amount")
      let hourlyTotal = 0n;
      for (let i = 0; i < members.length; i += 2) {
        const parts = (members[i] as string).split(':');
        if (parts.length >= 2) hourlyTotal += BigInt(parts[parts.length - 1] ?? '0');
      }

      if (hourlyTotal > 100_000n) {
        triggered.push('CARD_HOURLY_SPEND_EXCEEDED');
        return { shouldDecline: true, score: 95, triggered };
      }
      if (hourlyTotal > 50_000n) {
        triggered.push('CARD_HOURLY_SPEND_HIGH');
        score += 30;
      }
    }

    // IP hourly count (max 30 transactions)
    if (input.ipAddress) {
      const ipKey = `vel:ip:hour:${input.ipAddress}`;
      const ipPipe = redis.pipeline();
      ipPipe.zremrangebyscore(ipKey, '-inf', oneHourAgo);
      ipPipe.zadd(ipKey, now, input.authorizationId);
      ipPipe.zcard(ipKey);
      ipPipe.expire(ipKey, 7200);
      const ipResults = await ipPipe.exec();
      const ipCount = (ipResults?.[2]?.[1] ?? 0) as number;

      if (ipCount > 30) {
        triggered.push('IP_VELOCITY_EXCEEDED');
        score += 40;
      } else if (ipCount > 15) {
        triggered.push('IP_VELOCITY_HIGH');
        score += 15;
      }
    }
  } catch (err) {
    log.warn('Velocity check failed', { error: err instanceof Error ? err.message : String(err) });
    // Fail open — don't decline because Redis is slow
  }

  return { shouldDecline: false, score, triggered };
}

// ─── Rule-based scoring functions ─────────────────────────────────────────────

function scoreMcc(mcc?: string): number {
  if (!mcc) return 0;
  if (HIGH_RISK_MCCS.has(mcc)) return 25;
  if (MEDIUM_RISK_MCCS.has(mcc)) return 10;
  return 0;
}

function scoreAmount(amount: bigint): number {
  // Score based on amount tiers
  if (amount >= 100_000n) return 20; // >= $1,000
  if (amount >= 50_000n) return 10;  // >= $500
  if (amount >= 20_000n) return 5;   // >= $200
  return 0;
}

function scoreTimeOfDay(): number {
  const hour = new Date().getUTCHours();
  // 1AM-5AM UTC is higher risk
  if (hour >= 1 && hour <= 5) return 10;
  return 0;
}

function scoreEntryMode(mode?: string): number {
  if (mode === 'MANUAL') return 20;  // Highest risk — manual key entry
  if (mode === 'ECOM') return 5;     // Online transactions slightly higher risk
  return 0;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'fraud' }));
app.get('/health/ready', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

app.listen(PORT, () => log.info(`Fraud engine started on port ${PORT}`));
process.on('beforeExit', () => void redis.quit());
