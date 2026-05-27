import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function getPrismaSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}
