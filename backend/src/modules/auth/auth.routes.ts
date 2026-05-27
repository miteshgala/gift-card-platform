import { Router } from 'express';
import * as controller from './auth.controller';
import { authenticate } from './auth.middleware';
import { authRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterInput'
 *     responses:
 *       201:
 *         description: User created
 */
router.post('/register', authRateLimiter, controller.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and receive tokens
 */
router.post('/login', authRateLimiter, controller.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 */
router.post('/refresh', controller.refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and revoke refresh token
 *     security:
 *       - bearerAuth: []
 */
router.post('/logout', authenticate, controller.logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user info
 *     security:
 *       - bearerAuth: []
 */
router.get('/me', authenticate, controller.me);

export default router;
