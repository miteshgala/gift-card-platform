-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ssoClientId" TEXT,
ADD COLUMN     "ssoClientSecret" TEXT,
ADD COLUMN     "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ssoIssuerUrl" TEXT,
ADD COLUMN     "ssoProvider" TEXT,
ADD COLUMN     "ssoRedirectUri" TEXT;

-- CreateIndex
CREATE INDEX "Program_isSandbox_idx" ON "Program"("isSandbox");
