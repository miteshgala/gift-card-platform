import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log slow queries
prisma.$on('query' as never, (e: { query: string; duration: number }) => {
  if (e.duration > 500) {
    logger.warn('Slow query detected', {
      query: e.query.substring(0, 200),
      duration: `${e.duration}ms`,
    });
  }
});

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
