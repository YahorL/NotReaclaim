import type { PrismaClient, CalendarEvent, CalendarEventKind } from '@prisma/client';
import { deleteOwned, updateOwned } from './owned.js';

export interface CreateCalendarEventInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** `blocked` = local busy time, never mirrored to Google. Defaults to `event`. */
  kind?: CalendarEventKind;
}

export interface UpsertCalendarEventInput {
  googleCalendarId: string;
  googleEventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

/** `kind` is fixed at creation. */
export type UpdateCalendarEventInput = Partial<Omit<CreateCalendarEventInput, 'kind'>>;

export function createCalendarEventRepository(prisma: PrismaClient) {
  return {
    /** A locally created event (no Google ids until written back). */
    create(userId: string, data: CreateCalendarEventInput): Promise<CalendarEvent> {
      return prisma.calendarEvent.create({ data: { userId, ...data, source: 'app' } });
    },

    /** Edit an owned event's fields. Never touches `source` or the Google ids. */
    update(userId: string, id: string, data: UpdateCalendarEventInput): Promise<CalendarEvent> {
      return updateOwned(
        `CalendarEvent ${id}`,
        () => prisma.calendarEvent.updateMany({ where: { id, userId }, data }),
        () => prisma.calendarEvent.findFirstOrThrow({ where: { id, userId } }),
      );
    },

    /** Attach Google ids after a successful write-back. Throws NotFound for other users' events. */
    setGoogleIds(userId: string, id: string, googleCalendarId: string, googleEventId: string): Promise<CalendarEvent> {
      return updateOwned(
        `CalendarEvent ${id}`,
        () => prisma.calendarEvent.updateMany({ where: { id, userId }, data: { googleCalendarId, googleEventId } }),
        () => prisma.calendarEvent.findFirstOrThrow({ where: { id, userId } }),
      );
    },

    findById(userId: string, id: string): Promise<CalendarEvent | null> {
      return prisma.calendarEvent.findFirst({ where: { id, userId } });
    },

    /** Delete a single locally-listed event. Throws NotFound for missing / other users' events. */
    delete(userId: string, id: string): Promise<void> {
      return deleteOwned(`CalendarEvent ${id}`, () => prisma.calendarEvent.deleteMany({ where: { id, userId } }));
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
            create: { userId, ...e, source: 'google' },
            // Never touch `source` here: an app-created event that was written
            // back to Google and later mirrored must stay 'app'.
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

    /**
     * Drop the calendar's MIRRORED rows (source 'google') — the full-resync purge.
     * App-created events that were written back to Google keep source 'app' and must
     * survive: they are owned locally, and a re-mirror would only be able to recreate
     * them as read-only 'google' rows under a new id.
     */
    async deleteMirroredByCalendar(userId: string, googleCalendarId: string): Promise<void> {
      await prisma.calendarEvent.deleteMany({ where: { userId, googleCalendarId, source: 'google' } });
    },
  };
}

export type CalendarEventRepository = ReturnType<typeof createCalendarEventRepository>;
