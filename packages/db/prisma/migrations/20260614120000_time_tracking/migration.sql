-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "requireStartToTrack" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScheduledBlock" ADD COLUMN "startedAt" TIMESTAMPTZ;
