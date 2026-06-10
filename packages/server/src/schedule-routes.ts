import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule } from '@notreclaim/core';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema, createScheduledBlockSchema } from './schemas.js';

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

  app.post('/schedule', guard, async (request, reply) => {
    const body = createScheduledBlockSchema.parse(request.body);
    const task = await deps.repos.tasks.findById(request.userId, body.taskId);
    if (!task) {
      reply.code(404).send({ code: 'not_found', message: `Task ${body.taskId} not found` });
      return;
    }
    const block = await deps.repos.scheduledBlocks.create(request.userId, {
      taskId: task.id, title: task.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: true,
    });
    afterMutation(request.userId);
    reply.code(201);
    return block;
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
