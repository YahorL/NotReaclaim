import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { createHabitSchema, updateHabitSchema, idParamSchema } from './schemas.js';

export function registerHabitRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/habits', guard, async (request, reply) => {
    const body = createHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.create(request.userId, body);
    reply.code(201);
    return habit;
  });

  app.get('/habits', guard, async (request) => deps.repos.habits.listByUser(request.userId));

  app.get('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const habit = await deps.repos.habits.findById(request.userId, id);
    if (!habit) {
      reply.code(404).send({ code: 'not_found', message: `Habit ${id} not found` });
      return;
    }
    return habit;
  });

  app.patch('/habits/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateHabitSchema.parse(request.body);
    return deps.repos.habits.update(request.userId, id, body);
  });

  app.delete('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.habits.delete(request.userId, id);
    reply.code(204).send();
  });
}
