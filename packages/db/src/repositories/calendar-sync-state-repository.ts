import type { PrismaClient, CalendarSyncState } from '@prisma/client';

export interface UpsertSyncStateInput {
  syncToken?: string | null;
  lastSyncedAt?: Date | null;
}

export function createCalendarSyncStateRepository(prisma: PrismaClient) {
  return {
    getByCalendar(userId: string, googleCalendarId: string): Promise<CalendarSyncState | null> {
      return prisma.calendarSyncState.findUnique({
        where: { userId_googleCalendarId: { userId, googleCalendarId } },
      });
    },

    upsert(
      userId: string,
      googleCalendarId: string,
      data: UpsertSyncStateInput,
    ): Promise<CalendarSyncState> {
      return prisma.calendarSyncState.upsert({
        where: { userId_googleCalendarId: { userId, googleCalendarId } },
        create: { userId, googleCalendarId, ...data },
        update: data,
      });
    },
  };
}

export type CalendarSyncStateRepository = ReturnType<typeof createCalendarSyncStateRepository>;
