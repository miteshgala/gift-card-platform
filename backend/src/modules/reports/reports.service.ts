import { prisma } from '../../config/prisma';
import { CardStatus, LedgerEntryType } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import PDFDocument from 'pdfkit';

// ─── Outstanding Liability ────────────────────────────────────────────────────

export async function getOutstandingLiability(programId?: string) {
  const where = {
    status: { in: [CardStatus.ACTIVE, CardStatus.FROZEN] as CardStatus[] },
    ...(programId && { programId }),
  };

  const result = await prisma.giftCard.aggregate({
    where,
    _sum: { currentBalance: true },
    _count: { id: true },
  });

  return {
    totalLiability: Number(result._sum.currentBalance ?? 0),
    activeCards: result._count.id,
    programId,
    asOf: new Date(),
  };
}

// ─── Breakage Report ──────────────────────────────────────────────────────────

export async function getBreakageReport(filters: {
  programId?: string;
  from?: Date;
  to?: Date;
}) {
  const where = {
    status: { in: [CardStatus.EXPIRED, CardStatus.CANCELLED] as CardStatus[] },
    ...(filters.programId && { programId: filters.programId }),
    ...(filters.from || filters.to ? {
      updatedAt: {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      },
    } : {}),
  };

  const result = await prisma.giftCard.aggregate({
    where,
    _sum: { currentBalance: true, initialBalance: true },
    _count: { id: true },
  });

  const unredeemedValue = Number(result._sum.currentBalance ?? 0);
  const originalValue = Number(result._sum.initialBalance ?? 0);

  return {
    expiredCancelledCards: result._count.id,
    originalValue,
    redeemedValue: originalValue - unredeemedValue,
    breakageValue: unredeemedValue,
    breakageRate: originalValue > 0 ? ((unredeemedValue / originalValue) * 100).toFixed(2) + '%' : '0%',
    from: filters.from,
    to: filters.to,
    programId: filters.programId,
  };
}

// ─── Redemption Rate ──────────────────────────────────────────────────────────

export async function getRedemptionRate(filters: {
  programId?: string;
  from?: Date;
  to?: Date;
}) {
  const dateFilter = filters.from || filters.to ? {
    createdAt: {
      ...(filters.from && { gte: filters.from }),
      ...(filters.to && { lte: filters.to }),
    },
  } : {};

  const [total, redeemed, totalValue, redeemedValue] = await Promise.all([
    prisma.giftCard.count({
      where: { ...(filters.programId && { programId: filters.programId }), ...dateFilter },
    }),
    prisma.giftCard.count({
      where: {
        status: CardStatus.REDEEMED,
        ...(filters.programId && { programId: filters.programId }),
        ...dateFilter,
      },
    }),
    prisma.giftCard.aggregate({
      where: { ...(filters.programId && { programId: filters.programId }), ...dateFilter },
      _sum: { initialBalance: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        type: LedgerEntryType.REDEEM,
        ...(filters.programId && { card: { programId: filters.programId } }),
        ...dateFilter,
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalCards: total,
    redeemedCards: redeemed,
    cardRedemptionRate: total > 0 ? ((redeemed / total) * 100).toFixed(2) + '%' : '0%',
    totalIssuedValue: Number(totalValue._sum.initialBalance ?? 0),
    totalRedeemedValue: Number(redeemedValue._sum.amount ?? 0),
    valueRedemptionRate: Number(totalValue._sum.initialBalance ?? 0) > 0
      ? ((Number(redeemedValue._sum.amount ?? 0) / Number(totalValue._sum.initialBalance ?? 0)) * 100).toFixed(2) + '%'
      : '0%',
    from: filters.from,
    to: filters.to,
    programId: filters.programId,
  };
}

// ─── Transaction Volume Dashboard ─────────────────────────────────────────────

export async function getTransactionVolume(filters: {
  programId?: string;
  from?: Date;
  to?: Date;
  groupBy?: 'day' | 'week' | 'month';
}) {
  const dateFilter = {
    ...(filters.from && { gte: filters.from }),
    ...(filters.to && { lte: filters.to }),
  };

  const byType = await prisma.ledgerEntry.groupBy({
    by: ['type'],
    where: {
      ...(filters.programId && { card: { programId: filters.programId } }),
      ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
    },
    _sum: { amount: true },
    _count: { id: true },
  });

  return {
    byType: byType.map((r) => ({
      type: r.type,
      count: r._count.id,
      totalAmount: Number(r._sum.amount ?? 0),
    })),
    from: filters.from,
    to: filters.to,
  };
}

// ─── Escheatment Report ───────────────────────────────────────────────────────

export async function getEscheatmentReport(dormantDays: number, programId?: string) {
  const dormantThreshold = new Date(Date.now() - dormantDays * 24 * 60 * 60 * 1000);

  const cards = await prisma.giftCard.findMany({
    where: {
      status: CardStatus.ACTIVE,
      currentBalance: { gt: 0 },
      ...(programId && { programId }),
      OR: [
        { lastTransactionAt: { lt: dormantThreshold } },
        { lastTransactionAt: null, activatedAt: { lt: dormantThreshold } },
      ],
    },
    select: {
      id: true,
      cardNumberMasked: true,
      currentBalance: true,
      currency: true,
      recipientEmail: true,
      activatedAt: true,
      lastTransactionAt: true,
      program: { select: { name: true, slug: true } },
    },
    orderBy: { currentBalance: 'desc' },
  });

  const totalValue = cards.reduce((sum, c) => sum + Number(c.currentBalance), 0);

  return {
    dormantDays,
    dormantThreshold,
    cardCount: cards.length,
    totalValue,
    cards,
    programId,
    generatedAt: new Date(),
  };
}

// ─── Advanced Analytics Dashboard ────────────────────────────────────────────

export async function getAnalyticsDashboard(programId?: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cardWhere = programId ? { programId } : {};
  const ledgerCardWhere = programId ? { card: { programId } } : {};

  // ── Today's snapshot ───────────────────────────────────────────────────────
  const [
    cardsIssuedToday,
    redemptionsToday,
    loadVolumeToday,
    redeemVolumeToday,
    pendingKyc,
    activeLiability,
    totalCards,
  ] = await Promise.all([
    prisma.giftCard.count({
      where: { ...cardWhere, createdAt: { gte: todayStart } },
    }),
    prisma.ledgerEntry.count({
      where: { ...ledgerCardWhere, type: LedgerEntryType.REDEEM, createdAt: { gte: todayStart } },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...ledgerCardWhere, type: LedgerEntryType.LOAD, createdAt: { gte: todayStart } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...ledgerCardWhere, type: LedgerEntryType.REDEEM, createdAt: { gte: todayStart } },
      _sum: { amount: true },
    }),
    prisma.kycCheck.count({ where: { status: 'PENDING' } }),
    prisma.giftCard.aggregate({
      where: { ...cardWhere, status: { in: [CardStatus.ACTIVE, CardStatus.FROZEN] } },
      _sum: { currentBalance: true },
      _count: { id: true },
    }),
    prisma.giftCard.count({ where: cardWhere }),
  ]);

  // ── 30-day daily volume series ─────────────────────────────────────────────
  // Group ledger entries by day using raw query for cross-db compatibility
  const dailySeries = await prisma.$queryRawUnsafe<
    Array<{ day: string; type: string; total: number; count: number }>
  >(`
    SELECT
      DATE(le."createdAt") AS day,
      le.type,
      SUM(le.amount)::numeric AS total,
      COUNT(*)::int AS count
    FROM "LedgerEntry" le
    ${programId ? `JOIN "GiftCard" gc ON gc.id = le."cardId" AND gc."programId" = '${programId}'` : ''}
    WHERE le."createdAt" >= NOW() - INTERVAL '30 days'
      AND le.type IN ('LOAD', 'REDEEM', 'REFUND')
    GROUP BY day, le.type
    ORDER BY day ASC
  `);

  // Build a map: day → { LOAD, REDEEM, REFUND }
  const seriesMap: Record<string, { date: string; loads: number; redeems: number; refunds: number; netVolume: number }> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    seriesMap[key] = { date: key, loads: 0, redeems: 0, refunds: 0, netVolume: 0 };
  }
  for (const row of dailySeries) {
    const key = typeof row.day === 'string' ? row.day.slice(0, 10) : (row.day as Date).toISOString().slice(0, 10);
    if (!seriesMap[key]) continue;
    const amount = Number(row.total);
    if (row.type === 'LOAD') seriesMap[key].loads = amount;
    else if (row.type === 'REDEEM') seriesMap[key].redeems = amount;
    else if (row.type === 'REFUND') seriesMap[key].refunds = amount;
    seriesMap[key].netVolume = seriesMap[key].loads - seriesMap[key].redeems + seriesMap[key].refunds;
  }
  const volumeSeries = Object.values(seriesMap);

  // ── Top 5 redemption locations ─────────────────────────────────────────────
  const topLocationsRaw = await prisma.$queryRawUnsafe<Array<{ location: string; txCount: number; totalAmount: number }>>(
    `
    SELECT
      le.location,
      COUNT(*)::int AS "txCount",
      SUM(le.amount)::numeric AS "totalAmount"
    FROM "LedgerEntry" le
    ${programId ? `JOIN "GiftCard" gc ON gc.id = le."cardId" AND gc."programId" = '${programId}'` : ''}
    WHERE le.type = 'REDEEM'
      AND le.location IS NOT NULL
      AND le."createdAt" >= NOW() - INTERVAL '30 days'
    GROUP BY le.location
    ORDER BY "totalAmount" DESC
    LIMIT 5
    `
  );
  const topLocations = topLocationsRaw.map((r) => ({
    location: r.location,
    txCount: Number(r.txCount),
    totalAmount: Number(r.totalAmount),
  }));

  // ── Card status cohort ─────────────────────────────────────────────────────
  const statusCounts = await prisma.giftCard.groupBy({
    by: ['status'],
    where: cardWhere,
    _count: { id: true },
    _sum: { currentBalance: true },
  });
  const cohort = statusCounts.map((r) => ({
    status: r.status,
    cardCount: r._count.id,
    totalBalance: Number(r._sum.currentBalance ?? 0),
  }));

  return {
    asOf: now.toISOString(),
    programId,
    today: {
      cardsIssued: cardsIssuedToday,
      redemptions: redemptionsToday,
      loadVolume: Number(loadVolumeToday._sum.amount ?? 0),
      redeemVolume: Number(redeemVolumeToday._sum.amount ?? 0),
    },
    portfolio: {
      totalCards,
      activeCards: activeLiability._count.id,
      outstandingLiability: Number(activeLiability._sum.currentBalance ?? 0),
      pendingKyc,
    },
    volumeSeries,
    topLocations,
    cohort,
  };
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  return stringify(data, { header: true, columns: Object.keys(data[0]) });
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

export function generateReportPDF(title: string, data: Record<string, unknown>[]): Buffer {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text(title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: 'right' });
    doc.moveDown();

    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const colWidth = (doc.page.width - 80) / headers.length;

      // Header row
      doc.fontSize(9).fillColor('#333');
      headers.forEach((h, i) => {
        doc.text(h.toUpperCase(), 40 + i * colWidth, doc.y, { width: colWidth, continued: i < headers.length - 1 });
      });
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.5);

      // Data rows
      doc.fontSize(8).fillColor('#000');
      for (const row of data.slice(0, 500)) { // cap at 500 rows
        const rowY = doc.y;
        headers.forEach((h, i) => {
          const val = String(row[h] ?? '');
          doc.text(val.slice(0, 30), 40 + i * colWidth, rowY, { width: colWidth, continued: i < headers.length - 1 });
        });
        doc.moveDown(0.3);
        if (doc.y > doc.page.height - 60) doc.addPage();
      }
    }

    doc.end();
  }) as unknown as Buffer;
}
