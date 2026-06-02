import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { idParamSchema, createSubtaskSchema, updateSubtaskSchema } from './schemas.js';

export function registerSubtaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/subtasks', guard, async (request, reply) => {
    const body = createSubtaskSchema.parse(request.body);
    const subtask = await deps.repos.subtasks.create(request.userId, body.taskId, { title: body.title });
    reply.code(201);
    return subtask;
  });

  app.patch('/subtasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSubtaskSchema.parse(request.body);
    return deps.repos.subtasks.update(request.userId, id, body);
  });

  app.delete('/subtasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.subtasks.delete(request.userId, id);
    reply.code(204).send();
  });
}
