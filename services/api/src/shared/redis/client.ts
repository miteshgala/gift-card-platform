import { Redis } from 'ioredis';
import { env } from '../utils/env';
import { logger } from '../utils/logger';

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('connect', () => logger.info(`Redis [${name}] connected`));
  client.on('error', (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
  client.on('reconnecting', () => logger.warn(`Redis [${name}] reconnecting`));

  return client;
}

// Main Redis client — used for rate limiting, idempotency cache, session data
export const redis = createRedisClient('main');

// Dedicated subscriber client (cannot be used for commands while subscribed)
export const redisSub = createRedisClient('sub');

// Graceful shutdown
process.on('beforeExit', async () => {
  await redis.quit();
  await redisSub.quit();
});
