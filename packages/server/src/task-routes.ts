import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { listTasksQuerySchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/tasks', { onRequest: [app.authenticate] }, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    return deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
  });
}
