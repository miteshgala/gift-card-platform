/**
 * Background Job Scheduler
 *
 * All scheduled jobs use BullMQ with Redis. Each job type has its own queue.
 * The scheduler registers repeating jobs on startup.
 *
 * Jobs:
 *   - auth-expiry-sweep        every 15 minutes
 *   - dormancy-assessment      daily 2:00 AM UTC
 *   - escheatment-scan         1st of month 3:00 AM UTC
 *   - breakage-recognition     1st of month 4:00 AM UTC
 *   - reconciliation           daily 1:00 AM UTC
 *   - balance-checkpoint       every hour
 *   - idempotency-cleanup      every hour
 */

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import winston from 'winston';

const log = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'worker' },
  transports: [new winston.transports.Console({ format: winston.format.json() })],
});

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const connection = { connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) };

// ─── Queue definitions ────────────────────────────────────────────────────────

const schedulerQueue = new Queue('scheduler', connection);

// ─── Register recurring jobs ──────────────────────────────────────────────────

async function registerJobs(): Promise<void> {
  await schedulerQueue.upsertJobScheduler('auth-expiry-sweep', { every: 15 * 60 * 1000 }, { name: 'auth-expiry-sweep', data: {} });
  await schedulerQueue.upsertJobScheduler('balance-checkpoint', { every: 60 * 60 * 1000 }, { name: 'balance-checkpoint', data: {} });
  await schedulerQueue.upsertJobScheduler('idempotency-cleanup', { every: 60 * 60 * 1000 }, { name: 'idempotency-cleanup', data: {} });
  await schedulerQueue.upsertJobScheduler('reconciliation', { pattern: '0 1 * * *', tz: 'UTC' }, { name: 'reconciliation', data: {} });
  await schedulerQueue.upsertJobScheduler('dormancy-assessment', { pattern: '0 2 * * *', tz: 'UTC' }, { name: 'dormancy-assessment', data: {} });
  await schedulerQueue.upsertJobScheduler('escheatment-scan', { pattern: '0 3 1 * *', tz: 'UTC' }, { name: 'escheatment-scan', data: {} });
  await schedulerQueue.upsertJobScheduler('breakage-recognition', { pattern: '0 4 1 * *', tz: 'UTC' }, { name: 'breakage-recognition', data: {} });

  log.info('Recurring jobs registered');
}

// ─── Worker that processes scheduled jobs ─────────────────────────────────────

const schedulerWorker = new Worker('scheduler', async (job) => {
  log.info('Running scheduled job', { jobName: job.name });

  switch (job.name) {
    case 'auth-expiry-sweep': {
      const { runAuthExpirySweeper } = await import('./jobs/authExpirySweeper');
      await runAuthExpirySweeper();
      break;
    }
    case 'balance-checkpoint': {
      // Write checkpoints for all active accounts
      const { prismaRead, prisma } = await import('../../api/src/shared/db/prisma');
      const { writeCheckpoint } = await import('../../api/src/modules/ledger/ledger.service');
      const accounts = await prismaRead.account.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      for (const account of accounts) {
        await writeCheckpoint(account.id).catch((err: Error) => log.error('Checkpoint failed', { accountId: account.id, error: err.message }));
      }
      void prisma;
      break;
    }
    case 'reconciliation': {
      const { prismaRead } = await import('../../api/src/shared/db/prisma');
      const { reconcileProgram } = await import('../../api/src/modules/ledger/ledger.service');
      const programs = await prismaRead.program.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const program of programs) {
        await reconcileProgram(program.id).catch((err: Error) => log.error('Reconciliation failed', { programId: program.id, error: err.message }));
      }
      break;
    }
    case 'dormancy-assessment': {
      const { runDormancyAssessment } = await import('./jobs/dormancyAssessment');
      await runDormancyAssessment();
      break;
    }
    case 'escheatment-scan': {
      const { runEscheatmentScan } = await import('./jobs/escheatmentScan');
      await runEscheatmentScan();
      break;
    }
    case 'breakage-recognition': {
      const { runBreakageRecognition } = await import('./jobs/breakageRecognition');
      await runBreakageRecognition();
      break;
    }
    case 'idempotency-cleanup': {
      const { prisma } = await import('../../api/src/shared/db/prisma');
      const deleted = await prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      log.info('Idempotency cleanup', { deleted: deleted.count });
      break;
    }
    default:
      log.warn('Unknown job', { jobName: job.name });
  }
}, {
  ...connection,
  concurrency: 1, // Scheduled jobs run one at a time to prevent overlapping runs
});

schedulerWorker.on('completed', (job) => log.info('Job completed', { jobName: job.name }));
schedulerWorker.on('failed', (job, err) => log.error('Job failed', { jobName: job?.name, error: err.message }));

// ─── Card issuance worker (handles async bulk order processing) ───────────────

const issuanceWorker = new Worker('card-issuance', async (job) => {
  const { orderId, lineItemId } = job.data as { orderId: string; lineItemId: string };
  const { runCardIssuance } = await import('./jobs/cardIssuance');
  await runCardIssuance(orderId, lineItemId);
}, {
  ...connection,
  concurrency: Number(process.env['WORKER_CONCURRENCY'] ?? 5),
});

issuanceWorker.on('failed', (job, err) => {
  log.error('Card issuance failed', { jobId: job?.id, orderId: job?.data?.orderId, error: err.message });
});

// ─── Webhook delivery worker ───────────────────────────────────────────────────

const webhookWorker = new Worker('webhook-delivery', async (job) => {
  const { deliveryId } = job.data as { deliveryId: string };
  const { runWebhookDelivery } = await import('./jobs/webhookDelivery');
  await runWebhookDelivery(deliveryId);
}, {
  ...connection,
  concurrency: 10,
});

webhookWorker.on('failed', (job, err) => {
  log.error('Webhook delivery failed', { deliveryId: job?.data?.deliveryId, error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await registerJobs();
  log.info('Worker scheduler started', {
    queues: ['scheduler', 'card-issuance', 'webhook-delivery'],
  });
}

void start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await schedulerWorker.close();
  await issuanceWorker.close();
  await webhookWorker.close();
  await redis.quit();
  process.exit(0);
});
