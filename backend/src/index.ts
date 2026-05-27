import './config/env'; // validate env first
import { connectDB, disconnectDB } from './config/prisma';
import { connectRedis, redis } from './config/redis';
import { logger } from './config/logger';
import { env } from './config/env';
import app from './app';

// Import queues to initialize workers
import './queues/issuance.queue';

async function main() {
  try {
    await connectDB();
    await connectRedis();

    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 Gift Card API running on port ${env.PORT}`, {
        env: env.NODE_ENV,
        docs: `http://localhost:${env.PORT}/api-docs`,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await disconnectDB();
        await redis.quit();
        logger.info('Server shut down');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start server', { error: err instanceof Error ? err.message : err });
    process.exit(1);
  }
}

main();
