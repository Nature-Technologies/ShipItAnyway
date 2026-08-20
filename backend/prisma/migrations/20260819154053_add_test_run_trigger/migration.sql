-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULE', 'CI');

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "trigger" "RunTrigger" NOT NULL DEFAULT 'MANUAL';

-- Backfill: runs linked to a schedule are SCHEDULE-triggered
UPDATE "TestRun" SET "trigger" = 'SCHEDULE' WHERE "scheduleId" IS NOT NULL;
