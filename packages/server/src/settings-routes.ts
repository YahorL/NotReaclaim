import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { ZodError } from 'zod';
import { settingsSchema, patchSettingsSchema, DEFAULT_CHUNK_ORDER } from './schemas.js';
import { dataChanged } from './events.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };
  const announceAndReplan = (userId: string) => {
    // requireStartToTrack decides which blocks count as time spent: every task's spentMs.
    deps.events.emit(dataChanged(userId, 'settings', 'tasks', 'schedule'));
    afterMutation(userId);
  };

  app.get('/settings', guard, async (request) => {
    const settings = await deps.repos.settings.getByUserId(request.userId);
    if (!settings) throw new NotFoundError('Settings not configured');
    return settings;
  });

  app.put('/settings', guard, async (request) => {
    const body = settingsSchema.parse(request.body);
    const settings = await deps.repos.settings.upsert(request.userId, body);
    announceAndReplan(request.userId);
    return settings;
  });

  // Partial update: writes only the fields sent, so a page editing a few settings (Buffers)
  // cannot revert a concurrent change to the others. No stored row → 404, like GET.
  app.patch('/settings', guard, async (request) => {
    const patch = patchSettingsSchema.parse(request.body);
    if (patch.defaultMinChunkMs !== undefined || patch.defaultMaxChunkMs !== undefined) {
      const stored = await deps.repos.settings.getByUserId(request.userId);
      if (!stored) throw new NotFoundError('Settings not configured');
      if ((patch.defaultMinChunkMs ?? stored.defaultMinChunkMs) > (patch.defaultMaxChunkMs ?? stored.defaultMaxChunkMs)) {
        throw new ZodError([{ code: 'custom', ...DEFAULT_CHUNK_ORDER }]);
      }
    }
    const settings = await deps.repos.settings.update(request.userId, patch);
    announceAndReplan(request.userId);
    return settings;
  });
}
