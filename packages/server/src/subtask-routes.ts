import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { idParamSchema, createSubtaskSchema, updateSubtaskSchema } from './schemas.js';

/**
 * Subtasks don't feed scheduling (core reads only Task columns), so a checklist change never
 * replans. It only tells other clients the parent task changed: `task.changed` is what the
 * web client already maps to a refetch of the tasks query, which carries each task's subtasks.
 */
export function registerSubtaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };
  const announce = (userId: string, taskId: string) =>
    deps.events.emit({ type: 'task.changed', userId, taskId, action: 'updated' });

  app.post('/subtasks', guard, async (request, reply) => {
    const body = createSubtaskSchema.parse(request.body);
    const subtask = await deps.repos.subtasks.create(request.userId, body.taskId, { title: body.title });
    announce(request.userId, subtask.taskId);
    reply.code(201);
    return subtask;
  });

  app.patch('/subtasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSubtaskSchema.parse(request.body);
    const subtask = await deps.repos.subtasks.update(request.userId, id, body);
    announce(request.userId, subtask.taskId);
    return subtask;
  });

  app.delete('/subtasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    // The repo's delete doesn't return the row, so find the parent first (owner-scoped: the
    // caller's tasks, each with its subtasks). A miss means the delete below 404s anyway.
    const parent = (await deps.repos.tasks.listByUser(request.userId)).find((t) => t.subtasks.some((s) => s.id === id));
    await deps.repos.subtasks.delete(request.userId, id);
    if (parent) announce(request.userId, parent.id);
    return reply.code(204).send();
  });
}
