import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, createCalendarEventSchema, updateCalendarEventSchema, idParamSchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PRIMARY = 'primary';

export function registerCalendarRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/calendar/events', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const start = query.from ? new Date(query.from) : new Date(deps.now());
    let end: Date;
    if (query.to) {
      end = new Date(query.to);
    } else {
      const settings = await deps.repos.settings.getByUserId(request.userId);
      const horizonDays = settings?.horizonDays ?? 14;
      end = new Date(deps.now() + horizonDays * MS_PER_DAY);
    }
    return deps.repos.calendarEvents.listByUserInRange(request.userId, start, end);
  });

  app.post('/calendar/events', guard, async (request, reply) => {
    const body = createCalendarEventSchema.parse(request.body);
    let event = await deps.repos.calendarEvents.create(request.userId, {
      title: body.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt),
    });
    // Best-effort Google write-back: connected users get the event mirrored to their
    // primary calendar; failures (or no Google account) leave the local row authoritative.
    try {
      const accessToken = await deps.google.tokens.getAccessToken(request.userId, deps.now());
      const { googleEventId } = await deps.google.client.insertEvent(accessToken, PRIMARY, {
        summary: body.title, startDateTime: body.startsAt, endDateTime: body.endsAt,
      });
      event = await deps.repos.calendarEvents.setGoogleIds(request.userId, event.id, PRIMARY, googleEventId);
    } catch (err) {
      // Not connected or a Google failure — the local row stands, but say so in the log.
      app.log.warn({ err, eventId: event.id }, 'google write-back failed: event not mirrored');
    }
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
    if (!event || event.source !== 'app') {
      reply.code(404).send({ code: 'not_found', message: `Event ${id} not found` });
      return;
    }
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
    if (event.googleEventId && event.googleCalendarId) {
      try {
        const accessToken = await deps.google.tokens.getAccessToken(request.userId, deps.now());
        await deps.google.client.patchEvent(accessToken, event.googleCalendarId, event.googleEventId, {
          summary: title, startDateTime: startsAt.toISOString(), endDateTime: endsAt.toISOString(),
        });
      } catch (err) {
        // Not connected or a Google failure — the local row is authoritative, but the
        // Google copy is now stale, so this must be visible in the log.
        app.log.warn({ err, eventId: id }, 'google write-back failed: event edit not mirrored');
      }
    }
    afterMutation(request.userId);
    return updated;
  });

  app.delete('/calendar/events/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const event = await deps.repos.calendarEvents.findById(request.userId, id);
    if (!event) {
      reply.code(404).send({ code: 'not_found', message: `Event ${id} not found` });
      return;
    }
    // Best-effort Google removal for events previously written back to the primary calendar.
    if (event.googleEventId && event.googleCalendarId) {
      try {
        const accessToken = await deps.google.tokens.getAccessToken(request.userId, deps.now());
        await deps.google.client.deleteEvent(accessToken, event.googleCalendarId, event.googleEventId);
      } catch (err) {
        // The local delete still proceeds, so the Google copy may be orphaned: log it.
        app.log.warn({ err, eventId: id }, 'google write-back failed: event not removed remotely');
      }
    }
    await deps.repos.calendarEvents.delete(request.userId, id);
    afterMutation(request.userId);
    reply.code(204);
  });
}
