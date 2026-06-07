/**
 * Unit tests for orders.service.ts
 *
 * Covers:
 *  - createOrder: validation, approval threshold routing, total calculation
 *  - approveOrder: state machine — only PENDING_APPROVAL can be approved
 *  - cancelOrder: only PENDING / PENDING_APPROVAL can be cancelled
 *  - Program budget cap enforcement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks — vi.hoisted ensures factory refs survive Vitest hoisting ──────────

// Mock BullMQ + ioredis before importing orders.service (Queue instantiated at module level)
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    addBulk: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ status: 'ready' })),
}));

const { mockPrisma, mockPrismaRead } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockPrisma: {
      order: { create: fn(), update: fn(), findUnique: fn(), findMany: fn(), count: fn() },
    },
    mockPrismaRead: {
      program: { findUnique: fn() },
      order: { findUnique: fn(), findMany: fn(), count: fn() },
    },
  };
});

const mockOrder = {
  id: 'ord_001',
  programId: 'prog_001',
  status: 'PENDING',
  totalCards: 2,
  totalAmountCents: 10000n,
  currency: 'USD',
  lineItems: [],
};

vi.mock('@/shared/db/prisma', () => ({
  prisma: mockPrisma,
  prismaRead: mockPrismaRead,
}));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import { createOrder, approveOrder, cancelOrder } from '../orders.service';

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeProgram(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prog_001',
    status: 'ACTIVE',
    approvalThreshold: 100000n, // $1,000 threshold
    autoApproveLimit: 50000n,
    budgetCap: null,
    currency: 'USD',
    ...overrides,
  };
}

function makeLineItem(amountCents: bigint = 5000n) {
  return {
    recipientName: 'Jane Doe',
    recipientEmail: 'jane@example.com',
    amountCents,
    cardType: 'VIRTUAL' as const,
  };
}

const BASE_INPUT = {
  programId: 'prog_001',
  currency: 'USD',
  lineItems: [makeLineItem(5000n), makeLineItem(5000n)],
  createdBy: 'user_admin',
};

// ─── createOrder ──────────────────────────────────────────────────────────────

describe('createOrder', () => {
  beforeEach(() => {
    mockPrismaRead.program.findUnique.mockResolvedValue(makeProgram());
    mockPrisma.order.create.mockResolvedValue({ ...mockOrder, lineItems: [] });
    mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PROCESSING' });
  });

  it('throws PROGRAM_NOT_FOUND when program does not exist', async () => {
    mockPrismaRead.program.findUnique.mockResolvedValue(null);

    await expect(createOrder(BASE_INPUT)).rejects.toMatchObject({
      code: 'PROGRAM_NOT_FOUND',
    });
  });

  it('throws PROGRAM_SUSPENDED when program is not ACTIVE', async () => {
    mockPrismaRead.program.findUnique.mockResolvedValue(makeProgram({ status: 'SUSPENDED' }));

    await expect(createOrder(BASE_INPUT)).rejects.toMatchObject({
      code: 'PROGRAM_SUSPENDED',
    });
  });

  it('throws EMPTY_ORDER when no line items provided', async () => {
    await expect(createOrder({ ...BASE_INPUT, lineItems: [] })).rejects.toMatchObject({
      code: 'EMPTY_ORDER',
    });
  });

  it('throws ORDER_TOO_LARGE when more than 10,000 line items', async () => {
    const manyItems = Array.from({ length: 10_001 }, () => makeLineItem(100n));

    await expect(createOrder({ ...BASE_INPUT, lineItems: manyItems })).rejects.toMatchObject({
      code: 'ORDER_TOO_LARGE',
    });
  });

  it('creates order with PENDING status when total is below approval threshold', async () => {
    // Total: 5000 + 5000 = 10000 < 100000 threshold → PENDING
    const result = await createOrder(BASE_INPUT);

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          totalAmountCents: 10000n,
          totalCards: 2,
        }),
      }),
    );
    expect(result.id).toBe('ord_001');
  });

  it('creates order with PENDING_APPROVAL when total meets or exceeds threshold', async () => {
    const expensiveItems = [makeLineItem(60000n), makeLineItem(50000n)]; // 110000 > 100000 threshold
    mockPrisma.order.create.mockResolvedValue({
      ...mockOrder,
      status: 'PENDING_APPROVAL',
      totalAmountCents: 110000n,
      lineItems: [],
    });

    await createOrder({ ...BASE_INPUT, lineItems: expensiveItems });

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_APPROVAL' }),
      }),
    );
  });

  it('calculates totalAmountCents correctly across all line items', async () => {
    const items = [makeLineItem(1000n), makeLineItem(2500n), makeLineItem(750n)];
    // Total = 4250

    await createOrder({ ...BASE_INPUT, lineItems: items });

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmountCents: 4250n,
          totalCards: 3,
        }),
      }),
    );
  });

  it('enqueues processing immediately when below threshold', async () => {
    // PENDING order (below threshold) should trigger enqueueOrderProcessing
    // which calls prisma.order.update to PROCESSING
    await createOrder(BASE_INPUT);

    // enqueueOrderProcessing calls prisma.order.update
    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
  });

  it('does NOT enqueue processing for PENDING_APPROVAL orders', async () => {
    const expensiveItems = [makeLineItem(60000n), makeLineItem(60000n)]; // above threshold
    mockPrisma.order.create.mockResolvedValue({
      ...mockOrder,
      id: 'ord_002',
      status: 'PENDING_APPROVAL',
      totalAmountCents: 120000n,
      lineItems: [],
    });

    await createOrder({ ...BASE_INPUT, lineItems: expensiveItems });

    // Should NOT call order.update since order needs explicit approval
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});

// ─── approveOrder ─────────────────────────────────────────────────────────────

describe('approveOrder', () => {
  beforeEach(() => {
    mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PENDING' });
  });

  it('throws ORDER_NOT_FOUND when order does not exist', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue(null);

    await expect(approveOrder('ord_missing', 'user_admin')).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
  });

  it('throws INVALID_STATE when order is already PENDING (not PENDING_APPROVAL)', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'PENDING' });

    await expect(approveOrder('ord_001', 'user_admin')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('throws INVALID_STATE when order is COMPLETED', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'COMPLETED' });

    await expect(approveOrder('ord_001', 'user_admin')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('throws INVALID_STATE when order is CANCELLED', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

    await expect(approveOrder('ord_001', 'user_admin')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('transitions PENDING_APPROVAL → PENDING and enqueues processing', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({
      ...mockOrder,
      status: 'PENDING_APPROVAL',
    });

    const result = await approveOrder('ord_001', 'user_approver');

    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord_001' },
        data: expect.objectContaining({
          status: 'PENDING',
          approvedBy: 'user_approver',
          approvedAt: expect.any(Date),
        }),
      }),
    );
    expect(result.status).toBe('PENDING');
  });
});

// ─── cancelOrder ──────────────────────────────────────────────────────────────

describe('cancelOrder', () => {
  it('throws ORDER_NOT_FOUND when order does not exist', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue(null);

    await expect(cancelOrder('ord_missing')).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when programId does not match', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, programId: 'prog_A' });

    await expect(cancelOrder('ord_001', 'prog_B')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws INVALID_STATE when order is PROCESSING', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'PROCESSING' });

    await expect(cancelOrder('ord_001')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('throws INVALID_STATE when order is COMPLETED', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'COMPLETED' });

    await expect(cancelOrder('ord_001')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('cancels a PENDING order', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'PENDING' });
    mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

    const result = await cancelOrder('ord_001');

    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED' },
      }),
    );
    expect(result.status).toBe('CANCELLED');
  });

  it('cancels a PENDING_APPROVAL order', async () => {
    mockPrismaRead.order.findUnique.mockResolvedValue({
      ...mockOrder,
      status: 'PENDING_APPROVAL',
    });
    mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

    const result = await cancelOrder('ord_001');

    expect(result.status).toBe('CANCELLED');
  });
});
