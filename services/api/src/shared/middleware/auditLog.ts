import { Request } from 'express';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

export type AuditCategory = 'USER' | 'CARD' | 'LEDGER' | 'ORDER' | 'FRAUD' | 'SYSTEM' | 'AUTH';

export interface AuditInput {
  action: string;
  category: AuditCategory;
  req: Request;
  resourceType?: string;
  resourceId?: string;
  programId?: string;
  details?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        category: input.category,
        actorId: input.req.user?.id ?? null,
        actorEmail: input.req.user?.email ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        programId: input.programId ?? input.req.user?.programId ?? null,
        ipAddress: input.req.ip ?? null,
        userAgent: input.req.headers['user-agent'] ?? null,
        details: (input.details ?? {}) as unknown as import('@prisma/client').Prisma.InputJsonValue,
        requestId: input.req.requestId,
      },
    });
  } catch (err) {
    // Audit log failure is not a reason to fail the request, but must be alerted
    logger.error('Failed to write audit log', {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
      requestId: input.req.requestId,
    });
  }
}
