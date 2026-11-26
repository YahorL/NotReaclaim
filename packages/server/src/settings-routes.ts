import type { FastifyInstance } from 'fastify';
import { NotFoundError, type Settings } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { ZodError } from 'zod';
import { settingsSchema, patchSettingsSchema, DEFAULT_CHUNK_ORDER } from './schemas.js';
import { dataChanged } from './events.js';

/**
 * requireStartSince follows requireStartToTrack, on the server clock: set when manual tracking is
 * switched ON (from off, or on a first PUT that creates the settings in manual mode), kept as it
 * is while it stays on (the settings form re-sends every field on save), cleared when it is
 * switched off (it means nothing in automatic mode). Task blocks that ended by then are kept as
 * history in manual mode (core isFrozenTaskRow / isDiscardableUnstarted). Never taken from the
 * client: the request schemas do not know the field, so a sent value is stripped.
 *
 * Every write that sends the mode also writes the timestamp — on → on writes back the one just
 * read — so the pair is always written together, from one read. The routes run that read and
 * the write under the user lock: two requests switching the mode cannot interleave (a save
 * keeping manual tracking on, read before a concurrent switch off and written after it, used to
 * leave manual tracking on with NO timestamp, and the next GET /schedule then swept all kept
 * history with its Google events).
 */
function trackingSince(stored: Settings | null, requireStartToTrack: boolean | undefined, now: number): { requireStartSince?: Date | null } {
  if (requireStartToTrack === undefined) return {};
  if (!requireStartToTrack) return { requireStartSince: null };
  return stored?.requireStartToTrack ? { requireStartSince: stored.requireStartSince } : { requireStartSince: new Date(now) };
}

/** The settings as the client sees them: requireStartSince is the server's own bookkeeping. */
function publicSettings({ requireStartSince: _, ...rest }: Settings): Omit<Settings, 'requireStartSince'> {
  return rest;
}

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
    return publicSettings(settings);
  });

  app.put('/settings', guard, async (request) => {
    const body = settingsSchema.parse(request.body);
    const now = deps.now();
    const settings = await deps.withUserLock(request.userId, async () => {
      const stored = body.requireStartToTrack === undefined ? null : await deps.repos.settings.getByUserId(request.userId);
      return deps.repos.settings.upsert(request.userId, { ...body, ...trackingSince(stored, body.requireStartToTrack, now) });
    });
    announceAndReplan(request.userId);
    return publicSettings(settings);
  });

  // Partial update: writes only the fields sent, so a page editing a few settings (Buffers)
  // cannot revert a concurrent change to the others. No stored row → 404, like GET.
  app.patch('/settings', guard, async (request) => {
    const patch = patchSettingsSchema.parse(request.body);
    const now = deps.now();
    const needsStored = patch.defaultMinChunkMs !== undefined || patch.defaultMaxChunkMs !== undefined
      || patch.requireStartToTrack !== undefined;
    const settings = await deps.withUserLock(request.userId, async () => {
      const stored = needsStored ? await deps.repos.settings.getByUserId(request.userId) : null;
      if (patch.defaultMinChunkMs !== undefined || patch.defaultMaxChunkMs !== undefined) {
        if (!stored) throw new NotFoundError('Settings not configured');
        if ((patch.defaultMinChunkMs ?? stored.defaultMinChunkMs) > (patch.defaultMaxChunkMs ?? stored.defaultMaxChunkMs)) {
          throw new ZodError([{ code: 'custom', ...DEFAULT_CHUNK_ORDER }]);
        }
      }
      return deps.repos.settings.update(request.userId, { ...patch, ...trackingSince(stored, patch.requireStartToTrack, now) });
    });
    announceAndReplan(request.userId);
    return publicSettings(settings);
  });
}
