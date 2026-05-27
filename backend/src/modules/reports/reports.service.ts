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
