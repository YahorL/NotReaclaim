import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, createCalendarEventSchema } from './schemas.js';

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
    } catch { /* not connected or Google failure — local row stands */ }
    afterMutation(request.userId);
    reply.code(201);
    return event;
  });
}
