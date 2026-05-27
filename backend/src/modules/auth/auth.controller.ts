import { Request, Response } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { sendSuccess, sendCreated, sendError } from '../../utils/response';
import { AuthenticatedRequest } from '../../types';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const data = registerSchema.parse(req.body);
  const user = await authService.registerUser(data, req.ip);
  sendCreated(res, user);
}

export async function login(req: Request, res: Response): Promise<void> {
  const data = loginSchema.parse(req.body);
  const result = await authService.loginUser({
    ...data,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  });
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refreshTokens(
    refreshToken,
    req.headers['user-agent'],
    req.ip
  );
  sendSuccess(res, result);
}

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { refreshToken } = logoutSchema.parse(req.body);
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
    return;
  }
  await authService.logoutUser(refreshToken, req.user.sub, req.ip);
  sendSuccess(res, { message: 'Logged out successfully' });
}

export async function me(req: AuthenticatedRequest, res: Response): Promise<void> {
  sendSuccess(res, req.user);
}
