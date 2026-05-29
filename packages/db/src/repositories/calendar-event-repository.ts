import type { PrismaClient, CalendarEvent } from '@prisma/client';

export interface UpsertCalendarEventInput {
  googleCalendarId: string;
  googleEventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export function createCalendarEventRepository(prisma: PrismaClient) {
  return {
    /** Events whose [startsAt, endsAt) overlaps [start, end). */
    listByUserInRange(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
      return prisma.calendarEvent.findMany({
        where: { userId, startsAt: { lt: end }, endsAt: { gt: start } },
        orderBy: { startsAt: 'asc' },
      });
    },

    async upsertMany(userId: string, events: UpsertCalendarEventInput[]): Promise<void> {
      await prisma.$transaction(
        events.map((e) =>
          prisma.calendarEvent.upsert({
            where: {
              userId_googleCalendarId_googleEventId: {
                userId,
                googleCalendarId: e.googleCalendarId,
                googleEventId: e.googleEventId,
              },
            },
            create: { userId, ...e },
            update: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt },
          }),
        ),
      );
    },

    async deleteByGoogleEventIds(userId: string, googleEventIds: string[]): Promise<void> {
      await prisma.calendarEvent.deleteMany({
        where: { userId, googleEventId: { in: googleEventIds } },
      });
    },

    async deleteByUser(userId: string): Promise<void> {
      await prisma.calendarEvent.deleteMany({ where: { userId } });
    },
  };
}

export type CalendarEventRepository = ReturnType<typeof createCalendarEventRepository>;
