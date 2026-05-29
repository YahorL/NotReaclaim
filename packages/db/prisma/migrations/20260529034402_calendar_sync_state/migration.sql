-- CreateTable
CREATE TABLE "CalendarSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CalendarSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSyncState_userId_googleCalendarId_key" ON "CalendarSyncState"("userId", "googleCalendarId");

-- AddForeignKey
ALTER TABLE "CalendarSyncState" ADD CONSTRAINT "CalendarSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
