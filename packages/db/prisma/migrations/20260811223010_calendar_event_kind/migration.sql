-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('event', 'blocked');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "kind" "CalendarEventKind" NOT NULL DEFAULT 'event';
