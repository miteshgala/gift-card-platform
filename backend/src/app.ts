import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { resolveSandboxMode } from './middleware/sandbox';

// Route modules
import authRoutes from './modules/auth/auth.routes';
import ssoRoutes from './modules/auth/sso.routes';
import cardsRoutes from './modules/cards/cards.routes';
import ledgerRoutes from './modules/ledger/ledger.routes';
import fraudRoutes from './modules/fraud/fraud.routes';
import ordersRoutes from './modules/orders/orders.routes';
import programsRoutes from './modules/programs/programs.routes';
import webhooksRoutes from './modules/webhooks/webhooks.routes';
import reportsRoutes from './modules/reports/reports.routes';
import usersRoutes from './modules/users/users.routes';

const app = express();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') ?? []
    : '*',
  credentials: true,
}));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
app.use('/api/', apiRateLimiter);

// ─── Sandbox / API Key Resolution ────────────────────────────────────────────
app.use('/api/v1/', resolveSandboxMode);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── OpenAPI / Swagger ────────────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Gift Card Management API',
      version: '1.0.0',
      description: 'Enterprise Gift Card Management Platform API',
    },
    servers: [{ url: '/api/v1', description: 'V1 API' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/modules/**/*.routes.ts', './src/modules/**/*.controller.ts'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/v1/openapi.json', (_req, res) => res.json(swaggerSpec));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth/sso', ssoRoutes);
app.use('/api/v1/cards', cardsRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/fraud', fraudRoutes);
app.use('/api/v1/orders', ordersRoutes);
app.use('/api/v1/programs', programsRoutes);
app.use('/api/v1/integrations', webhooksRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/users', usersRoutes);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
