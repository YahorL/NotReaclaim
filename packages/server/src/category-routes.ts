import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { idParamSchema, createCategorySchema, updateCategorySchema } from './schemas.js';
import { dataChanged } from './events.js';

export function registerCategoryRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };
  const announce = (userId: string) => deps.events.emit(dataChanged(userId, 'categories', 'schedule'));

  app.get('/categories', guard, async (request) => {
    await deps.repos.categories.ensureDefault(request.userId);
    return deps.repos.categories.listByUser(request.userId);
  });

  app.post('/categories', guard, async (request, reply) => {
    const body = createCategorySchema.parse(request.body);
    const category = await deps.repos.categories.create(request.userId, body);
    announce(request.userId);
    afterMutation(request.userId);
    reply.code(201);
    return category;
  });

  app.patch('/categories/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCategorySchema.parse(request.body);
    const category = await deps.repos.categories.update(request.userId, id, body);
    announce(request.userId);
    afterMutation(request.userId);
    return category;
  });

  app.delete('/categories/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.categories.delete(request.userId, id);
    // Tasks in the category have their categoryId nulled (onDelete: SetNull): tasks change too.
    deps.events.emit(dataChanged(request.userId, 'categories', 'tasks', 'schedule'));
    afterMutation(request.userId);
    return reply.code(204).send();
  });
}
