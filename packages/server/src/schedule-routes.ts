import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule, round15 } from '@notreclaim/core';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema, createScheduledBlockSchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/schedule', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(request.userId);

    // Manual mode: discard past task blocks that were never started (self-heal on load).
    if (settings?.requireStartToTrack) {
      const past = await deps.repos.scheduledBlocks.listByUserInRange(request.userId, new Date(0), new Date(now));
      for (const b of past) {
        if (b.taskId && b.startedAt == null && b.endsAt.getTime() <= now) {
          await deps.repos.scheduledBlocks.delete(request.userId, b.id);
        }
      }
    }

    const start = query.from ? new Date(query.from) : new Date(now);
    let end: Date;
    if (query.to) {
      end = new Date(query.to);
    } else {
      const horizonDays = settings?.horizonDays ?? 14;
      end = new Date(now + horizonDays * MS_PER_DAY);
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

  app.post('/schedule/:id/start', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) {
      reply.code(404).send({ code: 'not_found', message: `ScheduledBlock ${id} not found` });
      return;
    }
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: 'Only task blocks can be started' });
      return;
    }
    const now = deps.now();
    const snapped = round15(now);
    const data: { pinned: boolean; startedAt: Date; startsAt?: Date } = { pinned: true, startedAt: new Date(now) };
    // Pull the start to the snapped current time (Start always targets the upcoming task),
    // keeping the end. The lower-bound guard is gone so a future block is pulled forward too.
    if (snapped < blockRow.endsAt.getTime()) {
      data.startsAt = new Date(snapped);
    }
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });

  app.delete('/schedule/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    // No reconcile here: deleting a block clears it from the planner. The task (if any)
    // stays in Priorities and only reappears on an explicit re-plan.
    await deps.repos.scheduledBlocks.delete(request.userId, id);
    reply.code(204);
  });
}
