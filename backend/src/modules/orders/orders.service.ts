import { CardType, OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { issuanceQueue } from '../../queues/issuance.queue';
import { buildMeta, getPrismaSkip } from '../../utils/pagination';

export interface CreateOrderInput {
  programId: string;
  campaignId?: string;
  departmentId?: string;
  requestedByUserId: string;
  quantity: number;
  denomination?: number;
  currency?: string;
  cardType?: CardType;
  recipients?: Array<{ email: string; name?: string; denomination?: number }>;
  csvPath?: string;
}

export async function createOrder(input: CreateOrderInput) {
  // Check program exists and is active
  const program = await prisma.program.findUnique({ where: { id: input.programId } });
  if (!program || !program.isActive) throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');

  const denomination = input.denomination ?? 0;
  const totalValue = new Prisma.Decimal(denomination * input.quantity);

  // Program budget check
  if (program.budgetCap) {
    const remaining = program.budgetCap.sub(program.budgetUtilized);
    if (totalValue.gt(remaining)) {
      throw new AppError(402, 'BUDGET_EXCEEDED',
        `Order value $${totalValue} exceeds remaining program budget of $${remaining}`);
    }
  }

  // Department budget check
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept || dept.programId !== input.programId) {
      throw new AppError(404, 'DEPARTMENT_NOT_FOUND', 'Department not found');
    }
    if (dept.budgetCap) {
      const deptRemaining = dept.budgetCap.sub(dept.budgetUsed);
      if (totalValue.gt(deptRemaining)) {
        throw new AppError(402, 'DEPARTMENT_BUDGET_EXCEEDED',
          `Order value $${totalValue} exceeds remaining department budget of $${deptRemaining}`);
      }
    }
  }

  // Determine if approval is needed
  const needsApproval = program.approvalThreshold
    ? totalValue.gte(program.approvalThreshold)
    : false;

  const order = await prisma.order.create({
    data: {
      programId: input.programId,
      campaignId: input.campaignId,
      departmentId: input.departmentId,
      requestedByUserId: input.requestedByUserId,
      status: needsApproval ? OrderStatus.PENDING_APPROVAL : OrderStatus.APPROVED,
      quantity: input.quantity,
      denomination: denomination ? new Prisma.Decimal(denomination) : null,
      totalValue,
      currency: input.currency ?? 'USD',
      cardType: input.cardType ?? CardType.DIGITAL,
      recipientListUrl: input.csvPath,
      orderItems: input.recipients
        ? {
            create: input.recipients.map((r) => ({
              recipientEmail: r.email,
              recipientName: r.name,
              denomination: new Prisma.Decimal(r.denomination ?? denomination),
            })),
          }
        : undefined,
    },
    include: { orderItems: true },
  });

  // Auto-dispatch if approved — commit budget immediately
  if (!needsApproval) {
    await prisma.$transaction(async (tx) => {
      await tx.program.update({
        where: { id: input.programId },
        data: { budgetUtilized: { increment: totalValue } },
      });
      if (input.departmentId) {
        await tx.department.update({
          where: { id: input.departmentId },
          data: { budgetUsed: { increment: totalValue } },
        });
      }
    });
    await dispatchOrder(order.id);
  }

  return order;
}

export async function approveOrder(orderId: string, approvedByUserId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.status !== OrderStatus.PENDING_APPROVAL) {
    throw new AppError(400, 'INVALID_STATUS', `Order status is ${order.status}`);
  }

  // Re-validate budget at approval time (values may have changed since order was created)
  const program = await prisma.program.findUnique({ where: { id: order.programId } });
  if (!program || !program.isActive) throw new AppError(400, 'PROGRAM_INACTIVE', 'Program is no longer active');

  if (program.budgetCap) {
    const remaining = program.budgetCap.sub(program.budgetUtilized);
    if (order.totalValue.gt(remaining)) {
      throw new AppError(402, 'BUDGET_EXCEEDED',
        `Order value $${order.totalValue} exceeds remaining program budget of $${remaining}`);
    }
  }

  if (order.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: order.departmentId } });
    if (dept?.budgetCap) {
      const deptRemaining = dept.budgetCap.sub(dept.budgetUsed);
      if (order.totalValue.gt(deptRemaining)) {
        throw new AppError(402, 'DEPARTMENT_BUDGET_EXCEEDED',
          `Order value $${order.totalValue} exceeds remaining department budget of $${deptRemaining}`);
      }
    }
  }

  // Commit budget utilization atomically with the approval
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.APPROVED, approvedByUserId, approvedAt: new Date() },
    });
    await tx.program.update({
      where: { id: order.programId },
      data: { budgetUtilized: { increment: order.totalValue } },
    });
    if (order.departmentId) {
      await tx.department.update({
        where: { id: order.departmentId },
        data: { budgetUsed: { increment: order.totalValue } },
      });
    }
  });

  await dispatchOrder(orderId);
}

export async function dispatchOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

  const recipients = order.orderItems
    .filter((item) => item.recipientEmail != null)
    .map((item) => ({
      email: item.recipientEmail as string,
      name: item.recipientName ?? undefined,
      denomination: Number(item.denomination),
    }));

  const job = await issuanceQueue.add({
    orderId: order.id,
    programId: order.programId,
    campaignId: order.campaignId ?? undefined,
    denomination: Number(order.denomination ?? 0),
    currency: order.currency,
    cardType: order.cardType,
    csvPath: order.recipientListUrl ?? undefined,
    recipients: recipients.length > 0 ? recipients : undefined,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { jobId: String(job.id), status: OrderStatus.PROCESSING },
  });

  return job;
}

export async function getOrderById(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true, campaign: true, department: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return order;
}

export async function listOrders(filters: {
  programId?: string;
  status?: OrderStatus;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const where: Prisma.OrderWhereInput = {
    ...(filters.programId && { programId: filters.programId }),
    ...(filters.status && { status: filters.status }),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: getPrismaSkip(page, limit),
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { campaign: { select: { name: true } }, department: { select: { name: true } } },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, meta: buildMeta(total, page, limit) };
}

export async function getOrderJobStatus(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, jobId: true, jobProgress: true, failureReason: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

  let jobState: string | null = null;
  if (order.jobId) {
    const job = await issuanceQueue.getJob(order.jobId);
    if (job) jobState = await job.getState();
  }

  return { ...order, jobState };
}
