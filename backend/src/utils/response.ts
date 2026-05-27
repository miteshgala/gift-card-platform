import { Response } from 'express';
import { ApiError, ApiResponse, PaginationMeta } from '../types';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: PaginationMeta
): void {
  const response: ApiResponse<T> = { success: true, data, meta };
  res.status(statusCode).json(response);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, 201);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const error: ApiError = { code, message, details };
  const response: ApiResponse = { success: false, error };
  res.status(statusCode).json(response);
}

export function buildMeta(
  total: number,
  page: number,
  limit: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
