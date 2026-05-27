import { UserRole } from '@prisma/client';
import { Request } from 'express';

// ─── API Response Envelope ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;        // userId
  email: string;
  role: UserRole;
  programId?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  apiKey?: {
    id: string;
    programId: string;
    isSandbox: boolean;
  };
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
