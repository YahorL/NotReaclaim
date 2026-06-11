import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import type { UpdateCategoryInput } from '@notreclaim/db';
import { idParamSchema, createCategorySchema, updateCategorySchema } from './schemas.js';

export function registerCategoryRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/categories', guard, async (request) => {
    await deps.repos.categories.ensureDefault(request.userId);
    return deps.repos.categories.listByUser(request.userId);
  });

  app.post('/categories', guard, async (request, reply) => {
    const body = createCategorySchema.parse(request.body);
    const category = await deps.repos.categories.create(request.userId, body);
    afterMutation(request.userId);
    reply.code(201);
    return category;
  });

  app.patch('/categories/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCategorySchema.parse(request.body);
    // Cast: validated JSON is compatible with Prisma InputJsonValue; windows null is explicit.
    const category = await deps.repos.categories.update(request.userId, id, body as UpdateCategoryInput);
    afterMutation(request.userId);
    return category;
  });

  app.delete('/categories/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.categories.delete(request.userId, id);
    afterMutation(request.userId);
    reply.code(204).send();
  });
}
