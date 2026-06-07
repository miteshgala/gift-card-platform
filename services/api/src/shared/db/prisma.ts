import { PrismaClient } from '@prisma/client';
import { env } from '../utils/env';

// Primary database client (for writes + reads in transactions)
export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

// Read replica client (for non-critical reads)
export const prismaRead = new PrismaClient({
  datasources: { db: { url: env.DATABASE_READ_URL ?? env.DATABASE_URL } },
  log: ['warn', 'error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await prismaRead.$disconnect();
});
