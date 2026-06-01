import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule } from '@notreclaim/core';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/schedule', guard, async (request) => {
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
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });

  app.get('/schedule/preview', guard, async (request) => {
    return computeDesiredSchedule(deps.schedulingRepos, request.userId, deps.now());
  });

  app.post('/schedule/replan', guard, async (request) => {
    return deps.reconcile(request.userId, deps.now());
  });

  app.patch('/schedule/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateScheduledBlockSchema.parse(request.body);
    const data = {
      ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
      ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    };
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });
}
