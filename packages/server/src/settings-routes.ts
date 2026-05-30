import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { settingsSchema } from './schemas.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/settings', guard, async (request, reply) => {
    const settings = await deps.repos.settings.getByUserId(request.userId);
    if (!settings) {
      reply.code(404).send({ code: 'not_found', message: 'Settings not configured' });
      return;
    }
    return settings;
  });

  app.put('/settings', guard, async (request) => {
    const body = settingsSchema.parse(request.body);
    const settings = await deps.repos.settings.upsert(request.userId, {
      ...body,
      workingHours: body.workingHours as unknown as Prisma.InputJsonValue,
    });
    afterMutation(request.userId);
    return settings;
  });
}
