import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@notreclaim/db';
import { PRIMARY_CALENDAR_ID } from '@notreclaim/google';
import type { AppDeps, AfterMutation } from './app.js';
import { bestEffortGoogleWrite, removeMirroredEvent } from './google-writeback.js';
import { resolveRange } from './range.js';
import { rangeQuerySchema, createCalendarEventSchema, updateCalendarEventSchema, idParamSchema } from './schemas.js';
import { dataChanged } from './events.js';

export function registerCalendarRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };
  const announce = (userId: string) => deps.events.emit(dataChanged(userId, 'calendarEvents', 'schedule'));

  app.get('/calendar/events', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const { start, end } = await resolveRange(
      query, deps.now, async () => (await deps.repos.settings.getByUserId(request.userId))?.horizonDays,
    );
    return deps.repos.calendarEvents.listByUserInRange(request.userId, start, end);
  });

  app.post('/calendar/events', guard, async (request, reply) => {
    const body = createCalendarEventSchema.parse(request.body);
    const kind = body.kind ?? 'event';
    let event = await deps.repos.calendarEvents.create(request.userId, {
      title: body.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), kind,
    });
    // Blocked time is local-only by definition: skip the write-back entirely (not even an
    // access-token lookup, so a connected user gets no warn-log noise for it). The row keeps
    // null Google ids, which is what makes the PATCH/DELETE guards below skip Google too.
    if (kind !== 'blocked') {
      // Best-effort Google write-back: connected users get the event mirrored to their
      // primary calendar; failures (or no Google account) leave the local row authoritative.
      await bestEffortGoogleWrite(
        app, deps, request.userId,
        { fields: { eventId: event.id }, message: 'google write-back failed: event not mirrored' },
        async (accessToken) => {
          const { googleEventId } = await deps.google.client.insertEvent(accessToken, PRIMARY_CALENDAR_ID, {
            summary: body.title, startDateTime: body.startsAt, endDateTime: body.endsAt,
          });
          event = await deps.repos.calendarEvents.setGoogleIds(request.userId, event.id, PRIMARY_CALENDAR_ID, googleEventId);
        },
      );
    }
    announce(request.userId);
    afterMutation(request.userId);
    reply.code(201);
    return event;
  });

  // Only app-created events are editable here; Google-owned rows are mirrors of the
  // remote calendar and stay read-only (reported as 404 so ids don't leak).
  app.patch('/calendar/events/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCalendarEventSchema.parse(request.body);
    const event = await deps.repos.calendarEvents.findById(request.userId, id);
    if (!event || event.source !== 'app') throw new NotFoundError(`Event ${id} not found`);
    const startsAt = body.startsAt ? new Date(body.startsAt) : event.startsAt;
    const endsAt = body.endsAt ? new Date(body.endsAt) : event.endsAt;
    if (endsAt.getTime() <= startsAt.getTime()) {
      reply.code(400).send({ code: 'invalid_range', message: 'endsAt must be after startsAt' });
      return;
    }
    const title = body.title ?? event.title;
    const updated = await deps.repos.calendarEvents.update(request.userId, id, { title, startsAt, endsAt });
    // Best-effort Google write-back for events previously mirrored to Google. PATCH (merge),
    // not PUT — the user may have added a description/location/attendees on the Google side.
    // A failure leaves the Google copy stale, so it must be visible in the log.
    const { googleEventId, googleCalendarId } = event;
    if (googleEventId && googleCalendarId) {
      await bestEffortGoogleWrite(
        app, deps, request.userId,
        { fields: { eventId: id }, message: 'google write-back failed: event edit not mirrored' },
        (accessToken) => deps.google.client.patchEvent(accessToken, googleCalendarId, googleEventId, {
          summary: title, startDateTime: startsAt.toISOString(), endDateTime: endsAt.toISOString(),
        }),
      );
    }
    announce(request.userId);
    afterMutation(request.userId);
    return updated;
  });

  app.delete('/calendar/events/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const event = await deps.repos.calendarEvents.findById(request.userId, id);
    if (!event) throw new NotFoundError(`Event ${id} not found`);
    // Best-effort Google removal for events previously written back to the primary calendar.
    // The local delete still proceeds on failure, so the Google copy may be orphaned: log it.
    await removeMirroredEvent(app, deps, request.userId, event, {
      fields: { eventId: id }, message: 'google write-back failed: event not removed remotely',
    });
    await deps.repos.calendarEvents.delete(request.userId, id);
    announce(request.userId);
    afterMutation(request.userId);
    return reply.code(204).send();
  });
}
