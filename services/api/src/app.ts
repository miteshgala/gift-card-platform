import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './shared/utils/env';
import { logger } from './shared/utils/logger';
import { requestId } from './shared/middleware/requestId';
import { errorHandler } from './shared/middleware/errorHandler';
import { globalLimiter } from './shared/middleware/rateLimiter';
import { registry } from './shared/utils/metrics';
import http from 'http';

// ─── Route imports ────────────────────────────────────────────────────────────
import { authRouter } from './modules/auth/auth.routes';
import { cardsRouter } from './modules/cards/cards.routes';
import { programsRouter } from './modules/programs/programs.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { departmentsRouter } from './modules/departments/departments.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { usersRouter } from './modules/users/users.routes';
import { fraudRouter } from './modules/fraud/fraud.routes';
import { kycRouter } from './modules/kyc/kyc.routes';
import { settlementRouter } from './modules/settlement/settlement.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';
import { disputesRouter } from './modules/disputes/disputes.routes';
import { integrationsRouter } from './modules/integrations/integrations.routes';
import { auditLogRouter } from './modules/audit/audit.routes';
import { cardholderRouter } from './modules/cardholder/cardholder.routes';

const app = express();

// ─── Trust proxy (behind nginx / load balancer) ───────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: [env.FRONTEND_URL],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }),
);

// ─── Compression ──────────────────────────────────────────────────────────────
app.use(compression());

// ─── Body parsing with raw body capture (for HMAC verification) ───────────────
app.use(
  express.json({
    limit: '10mb',
    verify: (req: Request, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request ID ───────────────────────────────────────────────────────────────
app.use(requestId);

// ─── HTTP request logging ─────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  });
  next();
});

// ─── Global rate limiting ─────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Health endpoints ─────────────────────────────────────────────────────────
app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'api', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, boolean> = {};
  let healthy = true;

  // Check DB
  try {
    const { prisma } = await import('./shared/db/prisma');
    await prisma.$queryRaw`SELECT 1`;
    checks['database'] = true;
  } catch {
    checks['database'] = false;
    healthy = false;
  }

  // Check Redis
  try {
    const { redis } = await import('./shared/redis/client');
    await redis.ping();
    checks['redis'] = true;
  } catch {
    checks['redis'] = false;
    healthy = false;
  }

  const status = healthy ? 200 : 503;
  res.status(status).json({ status: healthy ? 'ready' : 'not_ready', checks, timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const v1 = express.Router();

v1.use('/auth', authRouter);
v1.use('/cards', cardsRouter);
v1.use('/programs', programsRouter);
v1.use('/campaigns', campaignsRouter);
v1.use('/departments', departmentsRouter);
v1.use('/orders', ordersRouter);
v1.use('/users', usersRouter);
v1.use('/fraud', fraudRouter);
v1.use('/kyc', kycRouter);
v1.use('/settlement', settlementRouter);
v1.use('/reports', reportsRouter);
v1.use('/webhooks', webhooksRouter);
v1.use('/disputes', disputesRouter);
v1.use('/integrations', integrationsRouter);
v1.use('/audit-log', auditLogRouter);
v1.use('/cardholder', cardholderRouter);

app.use('/api/v1', v1);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ─── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ─── Metrics server (internal only, separate port) ────────────────────────────
const metricsApp = express();
metricsApp.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(`API server started on port ${env.PORT}`, {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
    });
  });

  metricsApp.listen(env.METRICS_PORT, '127.0.0.1', () => {
    logger.info(`Metrics server started on port ${env.METRICS_PORT} (internal only)`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forceful shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();

export { app };
