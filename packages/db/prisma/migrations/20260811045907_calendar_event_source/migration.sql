-- CreateEnum
CREATE TYPE "CalendarEventSource" AS ENUM ('app', 'google');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "source" "CalendarEventSource" NOT NULL DEFAULT 'google';
