-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "HrIntegration" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "signingSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "eventDenominations" JSONB NOT NULL DEFAULT '{}',
    "defaultCampaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycCheck" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrIntegration_programId_key" ON "HrIntegration"("programId");

-- CreateIndex
CREATE INDEX "HrIntegration_programId_idx" ON "HrIntegration"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "KycCheck_cardId_key" ON "KycCheck"("cardId");

-- CreateIndex
CREATE INDEX "KycCheck_status_idx" ON "KycCheck"("status");

-- CreateIndex
CREATE INDEX "KycCheck_cardId_idx" ON "KycCheck"("cardId");

-- CreateIndex
CREATE INDEX "KycCheck_createdAt_idx" ON "KycCheck"("createdAt");

-- AddForeignKey
ALTER TABLE "HrIntegration" ADD CONSTRAINT "HrIntegration_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycCheck" ADD CONSTRAINT "KycCheck_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
