-- AlterTable: add autoScheduledCalendarId to User
ALTER TABLE "User" ADD COLUMN "autoScheduledCalendarId" TEXT;

-- AlterTable: add engineKey to ScheduledBlock
ALTER TABLE "ScheduledBlock" ADD COLUMN "engineKey" TEXT;

-- CreateIndex: unique constraint on (userId, engineKey)
CREATE UNIQUE INDEX "ScheduledBlock_userId_engineKey_key" ON "ScheduledBlock"("userId", "engineKey");
