import { PrismaClient, UserRole, CardType } from '@prisma/client';
import { hashPassword } from '../utils/crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Super Admin ──────────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@giftcards.example.com' },
    update: {},
    create: {
      email: 'admin@giftcards.example.com',
      passwordHash: await hashPassword('Admin1234!'),
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });
  console.log('✅ Super admin created:', superAdmin.email);

  // ─── Demo Program ─────────────────────────────────────────────────────────
  const program = await prisma.program.upsert({
    where: { slug: 'demo-program' },
    update: {},
    create: {
      name: 'Demo Corporate Program',
      slug: 'demo-program',
      description: 'Demonstration gift card program',
      currency: 'USD',
      budgetCap: 100000,
      approvalThreshold: 5000,
      cardExpiryDays: 365,
    },
  });
  console.log('✅ Program created:', program.name);

  // ─── Program Admin ────────────────────────────────────────────────────────
  const progAdmin = await prisma.user.upsert({
    where: { email: 'progadmin@giftcards.example.com' },
    update: {},
    create: {
      email: 'progadmin@giftcards.example.com',
      passwordHash: await hashPassword('Admin1234!'),
      firstName: 'Program',
      lastName: 'Admin',
      role: UserRole.PROGRAM_ADMIN,
      programId: program.id,
      emailVerified: true,
    },
  });
  console.log('✅ Program admin created:', progAdmin.email);

  // ─── Demo Campaign ────────────────────────────────────────────────────────
  const campaign = await prisma.campaign.upsert({
    where: { id: 'seed-campaign-01' },
    update: {},
    create: {
      id: 'seed-campaign-01',
      programId: program.id,
      name: 'Holiday 2025',
      description: 'Holiday season promotion',
      bonusLoadPercent: 10,
      expiryDays: 180,
    },
  });
  console.log('✅ Campaign created:', campaign.name);

  // ─── Demo Velocity Rule ───────────────────────────────────────────────────
  await prisma.velocityRule.create({
    data: {
      programId: program.id,
      name: 'Hourly spend limit',
      windowSeconds: 3600,
      maxAmount: 500,
      scope: 'card',
    },
  });
  console.log('✅ Velocity rule created');

  // ─── Demo Department ──────────────────────────────────────────────────────
  await prisma.department.upsert({
    where: { programId_name: { programId: program.id, name: 'Marketing' } },
    update: {},
    create: {
      programId: program.id,
      name: 'Marketing',
      budgetCap: 25000,
    },
  });
  console.log('✅ Department created');

  console.log('\n🎉 Seed complete!');
  console.log('\n📋 Login credentials:');
  console.log('  Super Admin: admin@giftcards.example.com / Admin1234!');
  console.log('  Program Admin: progadmin@giftcards.example.com / Admin1234!');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
