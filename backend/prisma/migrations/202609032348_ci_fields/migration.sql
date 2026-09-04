-- AlterTable
ALTER TABLE "Project" ADD COLUMN "ghRepo" TEXT,
ADD COLUMN "ghPat" TEXT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN "ciRepo" TEXT,
ADD COLUMN "ciSha" TEXT,
ADD COLUMN "ciRef" TEXT,
ADD COLUMN "ciPrNumber" INTEGER,
ADD COLUMN "ciRunUrl" TEXT,
ADD COLUMN "ciCorrelationId" TEXT;

-- CreateIndex
CREATE INDEX "TestRun_ciCorrelationId_idx" ON "TestRun"("ciCorrelationId");

-- CreateEnum
CREATE TYPE "CiDeliveryState" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "CiDelivery" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "prNumber" INTEGER,
    "targetUrl" TEXT,
    "state" "CiDeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CiDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CiDelivery_correlationId_key" ON "CiDelivery"("correlationId");
