import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { createHabitSchema, updateHabitSchema, idParamSchema } from './schemas.js';
import { dataChanged } from './events.js';

export function registerHabitRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };
  const announce = (userId: string) => deps.events.emit(dataChanged(userId, 'habits', 'schedule'));

  app.post('/habits', guard, async (request, reply) => {
    const body = createHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.create(request.userId, body);
    announce(request.userId);
    afterMutation(request.userId);
    reply.code(201);
    return habit;
  });

  app.get('/habits', guard, async (request) => deps.repos.habits.listByUser(request.userId));

  app.get('/habits/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const habit = await deps.repos.habits.findById(request.userId, id);
    if (!habit) throw new NotFoundError(`Habit ${id} not found`);
    return habit;
  });

  app.patch('/habits/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.update(request.userId, id, body);
    announce(request.userId);
    afterMutation(request.userId);
    return habit;
  });

  app.delete('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.habits.delete(request.userId, id);
    announce(request.userId);
    afterMutation(request.userId);
    return reply.code(204).send();
  });
}
