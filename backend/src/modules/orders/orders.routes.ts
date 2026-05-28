import { Router } from 'express';
import { z } from 'zod';
import { CardType, OrderStatus } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { authenticate, requireMinRole } from '../auth/auth.middleware';
import { validate } from '../../middleware/validate';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as ordersService from './orders.service';
import { AuthenticatedRequest } from '../../types';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// CSV upload storage
const upload = multer({
  dest: 'uploads/csv/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.csv') cb(null, true);
    else cb(new Error('Only CSV files are allowed'));
  },
});

// ─── Create order ─────────────────────────────────────────────────────────────
const createOrderSchema = z.object({
  programId: z.string().cuid(),
  campaignId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  quantity: z.number().int().positive(),
  denomination: z.number().positive().optional(),
  currency: z.string().length(3).default('USD'),
  cardType: z.nativeEnum(CardType).default(CardType.DIGITAL),
  recipients: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    denomination: z.number().positive().optional(),
  })).optional(),
});

router.post(
  '/',
  requireMinRole(UserRole.MARKETING),
  validate(createOrderSchema),
  async (req: AuthenticatedRequest, res) => {
    const order = await ordersService.createOrder({
      ...req.body,
      requestedByUserId: req.user!.sub,
    });
    sendCreated(res, order);
  }
);

// ─── Upload CSV and create bulk order ─────────────────────────────────────────
router.post(
  '/bulk-csv',
  requireMinRole(UserRole.MARKETING),
  upload.single('recipients'),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      programId: z.string().cuid(),
      denomination: z.coerce.number().positive(),
      currency: z.string().length(3).default('USD'),
    });
    const body = schema.parse(req.body);
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'CSV file required' } });
      return;
    }
    const order = await ordersService.createOrder({
      ...body,
      quantity: 0, // will be counted during processing
      requestedByUserId: req.user!.sub,
      csvPath: req.file.path,
    });
    sendCreated(res, order);
  }
);

// ─── List orders ──────────────────────────────────────────────────────────────
const listSchema = z.object({
  programId: z.string().cuid().optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', validate(listSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  const filters = req.query as unknown as z.infer<typeof listSchema>;
  if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.programId) {
    filters.programId = req.user.programId;
  }
  const result = await ordersService.listOrders(filters);
  sendSuccess(res, result.orders, 200, result.meta);
});

// ─── Get order ────────────────────────────────────────────────────────────────
router.get('/:orderId', async (req, res) => {
  const order = await ordersService.getOrderById(req.params.orderId);
  sendSuccess(res, order);
});

// ─── Job status ───────────────────────────────────────────────────────────────
router.get('/:orderId/status', async (req, res) => {
  const status = await ordersService.getOrderJobStatus(req.params.orderId);
  sendSuccess(res, status);
});

// ─── Approve ──────────────────────────────────────────────────────────────────
router.post(
  '/:orderId/approve',
  requireMinRole(UserRole.PROGRAM_ADMIN),
  async (req: AuthenticatedRequest, res) => {
    await ordersService.approveOrder(req.params.orderId, req.user!.sub);
    sendSuccess(res, { approved: true });
  }
);

export default router;
