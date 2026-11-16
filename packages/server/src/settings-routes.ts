import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { settingsSchema } from './schemas.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/settings', guard, async (request) => {
    const settings = await deps.repos.settings.getByUserId(request.userId);
    if (!settings) throw new NotFoundError('Settings not configured');
    return settings;
  });

  app.put('/settings', guard, async (request) => {
    const body = settingsSchema.parse(request.body);
    const settings = await deps.repos.settings.upsert(request.userId, body);
    afterMutation(request.userId);
    return settings;
  });
}
