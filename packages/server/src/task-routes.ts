import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { createTaskSchema, updateTaskSchema, listTasksQuerySchema, idParamSchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/tasks', guard, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const task = await deps.repos.tasks.create(request.userId, { ...body, dueBy: new Date(body.dueBy) });
    afterMutation(request.userId, { taskId: task.id, action: 'created' });
    reply.code(201);
    return task;
  });

  app.get('/tasks', guard, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    return deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
  });

  app.get('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const task = await deps.repos.tasks.findById(request.userId, id);
    if (!task) {
      reply.code(404).send({ code: 'not_found', message: `Task ${id} not found` });
      return;
    }
    return task;
  });

  app.patch('/tasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { dueBy: dueByStr, ...rest } = updateTaskSchema.parse(request.body);
    const data = { ...rest, ...(dueByStr ? { dueBy: new Date(dueByStr) } : {}) };
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
