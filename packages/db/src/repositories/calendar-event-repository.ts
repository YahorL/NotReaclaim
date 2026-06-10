import type { PrismaClient, CalendarEvent } from '@prisma/client';
import { NotFoundError } from '../errors.js';

export interface CreateCalendarEventInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export interface UpsertCalendarEventInput {
  googleCalendarId: string;
  googleEventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export function createCalendarEventRepository(prisma: PrismaClient) {
  return {
    /** A locally created event (no Google ids until written back). */
    create(userId: string, data: CreateCalendarEventInput): Promise<CalendarEvent> {
      return prisma.calendarEvent.create({ data: { userId, ...data } });
    },

    /** Attach Google ids after a successful write-back. Throws NotFound for other users' events. */
    async setGoogleIds(userId: string, id: string, googleCalendarId: string, googleEventId: string): Promise<CalendarEvent> {
      const result = await prisma.calendarEvent.updateMany({ where: { id, userId }, data: { googleCalendarId, googleEventId } });
      if (result.count === 0) {
        throw new NotFoundError(`CalendarEvent ${id} not found for user`);
      }
      return prisma.calendarEvent.findUniqueOrThrow({ where: { id } });
    },

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

    async deleteByGoogleEventIds(
      userId: string,
      googleCalendarId: string,
      googleEventIds: string[],
    ): Promise<void> {
      await prisma.calendarEvent.deleteMany({
        where: { userId, googleCalendarId, googleEventId: { in: googleEventIds } },
      });
    },

    async deleteByCalendar(userId: string, googleCalendarId: string): Promise<void> {
      await prisma.calendarEvent.deleteMany({ where: { userId, googleCalendarId } });
    },

    async deleteByUser(userId: string): Promise<void> {
      await prisma.calendarEvent.deleteMany({ where: { userId } });
    },
  };
}

export type CalendarEventRepository = ReturnType<typeof createCalendarEventRepository>;
