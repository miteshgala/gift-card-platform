import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../shared/middleware/authenticate';
import { authLimiter } from '../../shared/middleware/rateLimiter';
import { idempotency } from '../../shared/middleware/idempotency';

export const authRouter = Router();

// Public routes (rate-limited)
authRouter.post('/login',           authLimiter, idempotency, authController.login);
authRouter.post('/refresh',         authLimiter, authController.refresh);
authRouter.post('/logout',          authController.logout);
authRouter.post('/forgot-password', authLimiter, authController.forgotPassword);
authRouter.post('/reset-password',  authLimiter, idempotency, authController.resetPassword);
authRouter.post('/accept-invite',   authLimiter, idempotency, authController.acceptInvite);
authRouter.get('/jwks',             authController.jwks);

// Authenticated routes
authRouter.get('/me',               authenticate, authController.me);
authRouter.post('/totp/setup',      authenticate, authController.setupTotp);
authRouter.post('/totp/verify',     authenticate, idempotency, authController.confirmTotp);
authRouter.post('/totp/disable',    authenticate, idempotency, authController.disableTotp);
