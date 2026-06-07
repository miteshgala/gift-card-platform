import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, acceptInviteSchema, verifyTotpSchema, changePasswordSchema } from './auth.types';

export const authController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const tokens = await authService.login(input, req);
      res.json({ data: tokens, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      const tokens = await authService.refresh(refreshToken, req);
      res.json({ data: tokens, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      await authService.logout(refreshToken, req);
      res.json({ data: { success: true }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      await authService.forgotPassword(email);
      // Always 200 — never reveal whether email exists
      res.json({ data: { message: 'If that email is registered, a reset link has been sent.' }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      await authService.resetPassword(token, newPassword);
      res.json({ data: { success: true }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = acceptInviteSchema.parse(req.body);
      const tokens = await authService.acceptInvite(token, password, req);
      res.json({ data: tokens, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ data: req.user, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async setupTotp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.setupTotp(req.user!.id);
      res.json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async confirmTotp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = verifyTotpSchema.parse(req.body);
      await authService.confirmTotp(req.user!.id, code);
      res.json({ data: { enabled: true }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async disableTotp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = verifyTotpSchema.parse(req.body);
      await authService.disableTotp(req.user!.id, code);
      res.json({ data: { enabled: false }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      await authService.changePassword(req.user!.id, currentPassword, newPassword, req);
      res.json({ data: { success: true }, meta: { requestId: req.requestId } });
    } catch (err) { next(err); }
  },

  async jwks(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(authService.getJwks());
    } catch (err) { next(err); }
  },
};
