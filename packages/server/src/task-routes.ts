import type { FastifyInstance } from 'fastify';
import { computeSpentMs } from '@notreclaim/core';
import type { AppDeps, AfterMutation } from './app.js';
import { createTaskSchema, updateTaskSchema, listTasksQuerySchema, idParamSchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  const attachSpent = async (userId: string, tasks: Array<{ id: string }>) => {
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(userId);
    const requireStart = settings?.requireStartToTrack ?? false;
    const blocks = await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(now));
    return tasks.map((t) => ({ ...t, spentMs: computeSpentMs(t.id, blocks, requireStart, now) }));
  };

  app.post('/tasks', guard, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const task = await deps.repos.tasks.create(request.userId, {
      ...body,
      dueBy: new Date(body.dueBy),
      notBefore: body.notBefore ? new Date(body.notBefore) : null,
    });
    afterMutation(request.userId, { taskId: task.id, action: 'created' });
    reply.code(201);
    return task;
  });

  app.get('/tasks', guard, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    const cutoff = new Date(deps.now() - 30 * 24 * 60 * 60 * 1000);
    await deps.repos.tasks.purgeCompletedBefore(request.userId, cutoff);
    const tasks = await deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
    return attachSpent(request.userId, tasks);
  });

  app.get('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const task = await deps.repos.tasks.findById(request.userId, id);
    if (!task) {
      reply.code(404).send({ code: 'not_found', message: `Task ${id} not found` });
      return;
    }
    const [withSpent] = await attachSpent(request.userId, [task]);
    return withSpent;
  });

  app.patch('/tasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { dueBy: dueByStr, notBefore: nbStr, ...rest } = updateTaskSchema.parse(request.body);
    const data = {
      ...rest,
      ...(dueByStr ? { dueBy: new Date(dueByStr) } : {}),
      ...(nbStr !== undefined ? { notBefore: nbStr === null ? null : new Date(nbStr) } : {}),
      ...(rest.status !== undefined
        ? { completedAt: rest.status === 'completed' ? new Date(deps.now()) : null }
        : {}),
    };
    const task = await deps.repos.tasks.update(request.userId, id, data);
    afterMutation(request.userId, { taskId: id, action: 'updated' });
    return task;
  });

  app.delete('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.tasks.delete(request.userId, id);
    afterMutation(request.userId, { taskId: id, action: 'deleted' });
    reply.code(204).send();
  });
}
