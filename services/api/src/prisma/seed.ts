/**
 * Database seed — creates the minimum viable data to run the platform locally.
 *
 * Run: npm run db:seed (from services/api/)
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function main(): Promise<void> {
  console.log('🌱 Seeding database...\n');

  // ─── Super Admin ───────────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@giftcards.example.com' },
    update: {},
    create: {
      email: 'admin@giftcards.example.com',
      passwordHash: await bcrypt.hash('Admin1234!', 12),
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    },
  });
  console.log('✅ Super Admin:', superAdmin.email);

  // ─── Demo Program (with all 5 accounts) ───────────────────────────────────
  // First create placeholder accounts, then the program referencing them
  const currency = 'USD';

  const floatAccount = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      accountType: 'FLOAT',
      normalBalance: 'DEBIT',
      currency,
      label: 'Demo Program Float',
      status: 'ACTIVE',
    },
  });

  const liabilityAccount = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      accountType: 'LIABILITY_RESERVE',
      normalBalance: 'CREDIT',
      currency,
      label: 'Demo Program Liability Reserve',
      status: 'ACTIVE',
    },
  });

  const breakageAccount = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      accountType: 'BREAKAGE',
      normalBalance: 'CREDIT',
      currency,
      label: 'Demo Program Breakage',
      status: 'ACTIVE',
    },
  });

  const feeAccount = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      accountType: 'FEE_INCOME',
      normalBalance: 'CREDIT',
      currency,
      label: 'Demo Program Fee Income',
      status: 'ACTIVE',
    },
  });

  const escrowAccount = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000005' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000005',
      accountType: 'ESCROW',
      normalBalance: 'CREDIT',
      currency,
      label: 'Demo Program Escheatment Escrow',
      status: 'ACTIVE',
    },
  });

  const program = await prisma.program.upsert({
    where: { slug: 'demo-corporate' },
    update: {},
    create: {
      slug: 'demo-corporate',
      name: 'Demo Corporate Program',
      description: 'Demonstration gift card program for development',
      currency,
      cardExpiryDays: 1825,       // 5 years (CARD Act minimum)
      dormancyFeeCents: 150n,     // $1.50/month dormancy fee
      dormancyMonths: 12,         // After 12 months inactivity
      budgetCap: 10_000_000n,     // $100,000
      approvalThreshold: 500_000n, // $5,000
      autoApproveLimit: 100_000n,  // $1,000
      kycRequiredAbove: 200_000n,  // $2,000
      status: 'ACTIVE',
      floatAccountId: floatAccount.id,
      liabilityAccountId: liabilityAccount.id,
      breakageAccountId: breakageAccount.id,
      feeAccountId: feeAccount.id,
      escrowAccountId: escrowAccount.id,
    },
  });
  console.log('✅ Program:', program.name);

  // Update accounts with programId
  await prisma.account.updateMany({
    where: { id: { in: [floatAccount.id, liabilityAccount.id, breakageAccount.id, feeAccount.id, escrowAccount.id] } },
    data: { programId: program.id },
  });

  // ─── Program Admin ─────────────────────────────────────────────────────────
  const progAdmin = await prisma.user.upsert({
    where: { email: 'progadmin@giftcards.example.com' },
    update: {},
    create: {
      email: 'progadmin@giftcards.example.com',
      passwordHash: await bcrypt.hash('Admin1234!', 12),
      firstName: 'Program',
      lastName: 'Admin',
      role: 'PROGRAM_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      programId: program.id,
    },
  });
  console.log('✅ Program Admin:', progAdmin.email);

  // ─── Campaign ──────────────────────────────────────────────────────────────
  const campaign = await prisma.campaign.upsert({
    where: { id: '00000000-0000-0000-0001-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000001',
      programId: program.id,
      name: 'Holiday 2025',
      description: 'Holiday season gift card promotion',
      bonusLoadPercent: 10,
      expiryDays: 365,
      status: 'ACTIVE',
    },
  });
  console.log('✅ Campaign:', campaign.name);

  // ─── Department ────────────────────────────────────────────────────────────
  await prisma.department.upsert({
    where: { programId_name: { programId: program.id, name: 'Marketing' } },
    update: {},
    create: {
      programId: program.id,
      name: 'Marketing',
      budgetCap: 2_500_000n, // $25,000
    },
  });
  console.log('✅ Department: Marketing');

  // ─── Velocity Rules ────────────────────────────────────────────────────────
  await prisma.velocityRule.createMany({
    skipDuplicates: true,
    data: [
      {
        programId: program.id,
        name: 'Hourly card spend limit',
        scope: 'CARD',
        windowSeconds: 3600,
        maxAmount: 50_000n, // $500/hour
        action: 'DECLINE',
        priority: 10,
      },
      {
        programId: program.id,
        name: 'Daily card transaction count',
        scope: 'CARD',
        windowSeconds: 86400,
        maxCount: 20,
        action: 'FLAG',
        priority: 20,
      },
      {
        programId: program.id,
        name: 'IP hourly transaction count',
        scope: 'IP',
        windowSeconds: 3600,
        maxCount: 50,
        action: 'FLAG',
        priority: 30,
      },
    ],
  });
  console.log('✅ Velocity rules created');

  // ─── GL Mappings ───────────────────────────────────────────────────────────
  await prisma.glMapping.createMany({
    skipDuplicates: true,
    data: [
      { programId: program.id, accountType: 'FLOAT', glAccountCode: '1010', glDescription: 'Gift Card Float — Cash', erpSystem: 'GENERIC' },
      { programId: program.id, accountType: 'LIABILITY_RESERVE', glAccountCode: '2010', glDescription: 'Gift Card Liability Reserve', erpSystem: 'GENERIC' },
      { programId: program.id, accountType: 'BREAKAGE', glAccountCode: '4010', glDescription: 'Gift Card Breakage Revenue', erpSystem: 'GENERIC' },
      { programId: program.id, accountType: 'FEE_INCOME', glAccountCode: '4020', glDescription: 'Gift Card Dormancy Fee Revenue', erpSystem: 'GENERIC' },
      { programId: program.id, accountType: 'ESCROW', glAccountCode: '2020', glDescription: 'Escheatment Escrow', erpSystem: 'GENERIC' },
    ],
  });
  console.log('✅ GL mappings created');

  // ─── HR Event Rules ────────────────────────────────────────────────────────
  await prisma.hrEventRule.createMany({
    skipDuplicates: true,
    data: [
      { programId: program.id, eventType: 'NEW_HIRE', amountCents: 25_000n, cardType: 'VIRTUAL' },       // $250
      { programId: program.id, eventType: 'WORK_ANNIVERSARY', amountCents: 5_000n, cardType: 'VIRTUAL' }, // $50
      { programId: program.id, eventType: 'PERFORMANCE_AWARD', amountCents: 50_000n, cardType: 'VIRTUAL' }, // $500
      { programId: program.id, eventType: 'BIRTHDAY', amountCents: 2_500n, cardType: 'VIRTUAL' },         // $25
      { programId: program.id, eventType: 'RETIREMENT', amountCents: 100_000n, cardType: 'VIRTUAL' },     // $1,000
    ],
  });
  console.log('✅ HR event rules created');

  console.log('\n🎉 Seed complete!\n');
  console.log('📋 Credentials:');
  console.log('  Super Admin:   admin@giftcards.example.com   / Admin1234!');
  console.log('  Program Admin: progadmin@giftcards.example.com / Admin1234!');
  console.log('\n📦 Program slug: demo-corporate');
  console.log(`  Float Account ID:     ${floatAccount.id}`);
  console.log(`  Liability Account ID: ${liabilityAccount.id}`);
  console.log(`  Breakage Account ID:  ${breakageAccount.id}`);
  console.log(`  Fee Account ID:       ${feeAccount.id}`);
  console.log(`  Escrow Account ID:    ${escrowAccount.id}`);
  void sha256; // used in token hashing utilities
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
