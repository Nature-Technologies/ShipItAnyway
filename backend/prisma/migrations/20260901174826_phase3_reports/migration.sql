-- AlterEnum: add report scopes
ALTER TYPE "Scope" ADD VALUE IF NOT EXISTS 'reports_read';
ALTER TYPE "Scope" ADD VALUE IF NOT EXISTS 'reports_edit';

-- CreateEnum
CREATE TYPE "ReportSendStatus" AS ENUM ('SENT', 'SKIPPED_EMPTY', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportSendTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateTable
CREATE TABLE "ReportConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "checkIds" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSend" (
    "id" TEXT NOT NULL,
    "reportConfigId" TEXT NOT NULL,
    "status" "ReportSendStatus" NOT NULL,
    "trigger" "ReportSendTrigger" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "passRate" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportConfig_projectId_idx" ON "ReportConfig"("projectId");

-- CreateIndex
CREATE INDEX "ReportConfig_environmentId_idx" ON "ReportConfig"("environmentId");

-- CreateIndex
CREATE INDEX "ReportSend_reportConfigId_idx" ON "ReportSend"("reportConfigId");

-- AddForeignKey
ALTER TABLE "ReportConfig" ADD CONSTRAINT "ReportConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportConfig" ADD CONSTRAINT "ReportConfig_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSend" ADD CONSTRAINT "ReportSend_reportConfigId_fkey" FOREIGN KEY ("reportConfigId") REFERENCES "ReportConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
