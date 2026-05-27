import IORedis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by Bull
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
