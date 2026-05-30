import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { rangeQuerySchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerCalendarRoutes(app: FastifyInstance, deps: AppDeps): void {
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
}
