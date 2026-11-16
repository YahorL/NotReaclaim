import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule, round15, QUARTER_HOUR_MS } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { bestEffortGoogleWrite } from './google-writeback.js';
import { resolveRange } from './range.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema, createScheduledBlockSchema } from './schemas.js';

export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/schedule', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(request.userId);

    // Manual mode: discard past task blocks that were never started (self-heal on load).
    if (settings?.requireStartToTrack) {
      const past = await deps.repos.scheduledBlocks.listByUserInRange(request.userId, new Date(0), new Date(now));
      for (const b of past) {
        if (b.taskId && b.startedAt == null && b.endsAt.getTime() <= now) {
          await deps.repos.scheduledBlocks.delete(request.userId, b.id);
        }
      }
    }

    const { start, end } = await resolveRange(query, () => now, async () => settings?.horizonDays);
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });

  app.get('/schedule/preview', guard, async (request) => {
    return computeDesiredSchedule(deps.schedulingRepos, request.userId, deps.now());
  });

  app.post('/schedule/replan', guard, async (request) => {
    return deps.reconcile(request.userId, deps.now());
  });

  app.post('/schedule', guard, async (request, reply) => {
    const body = createScheduledBlockSchema.parse(request.body);
    const task = await deps.repos.tasks.findById(request.userId, body.taskId);
    if (!task) throw new NotFoundError(`Task ${body.taskId} not found`);
    const block = await deps.repos.scheduledBlocks.create(request.userId, {
      taskId: task.id, title: task.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: true,
    });
    afterMutation(request.userId);
    reply.code(201);
    return block;
  });

  app.patch('/schedule/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateScheduledBlockSchema.parse(request.body);
    const data = {
      ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
      ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    };
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });

  app.post('/schedule/:id/start', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) throw new NotFoundError(`ScheduledBlock ${id} not found`);
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: 'Only task blocks can be started' });
      return;
    }
    const now = deps.now();
    const snapped = round15(now);
    const data: { pinned: boolean; startedAt: Date; startsAt?: Date } = { pinned: true, startedAt: new Date(now) };
    // Pull the start to the snapped current time (Start always targets the upcoming task),
    // keeping the end. The lower-bound guard is gone so a future block is pulled forward too.
    if (snapped < blockRow.endsAt.getTime()) {
      data.startsAt = new Date(snapped);
    }
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });

  app.post('/schedule/:id/stop', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) throw new NotFoundError(`ScheduledBlock ${id} not found`);
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: 'Only task blocks can be stopped' });
      return;
    }
    const now = deps.now();
    const startMs = blockRow.startsAt.getTime();
    const endMs = blockRow.endsAt.getTime();
    const minEnd = startMs + QUARTER_HOUR_MS;
    // End the running block now: snap end to the nearest 15 min, never below start+15 min
    // (no zero-length block) and never past the original end (Stop only shortens).
    const newEnd = Math.min(endMs, Math.max(round15(now), minEnd));
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, { endsAt: new Date(newEnd), pinned: true });
    afterMutation(request.userId);
    return block;
  });

  app.delete('/schedule/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    // No reconcile here: deleting a block clears it from the planner. The task (if any)
    // stays in Priorities and only reappears on an explicit re-plan. Skipping reconcile
    // does mean nothing else will ever sweep the mirrored event, so remove it here —
    // best-effort, exactly like the calendar routes: a Google failure must not block the
    // local delete, and a row with no Google ids never even looks up a token.
    // On a Google failure the row still goes, so the Google copy may be orphaned on the
    // Auto-scheduled calendar: the helper logs it.
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    const googleEventId = blockRow?.googleEventId;
    const googleCalendarId = blockRow?.googleCalendarId;
    if (googleEventId && googleCalendarId) {
      await bestEffortGoogleWrite(
        app, deps, request.userId,
        { fields: { blockId: id }, message: 'google write-back failed: block event not removed remotely' },
        (accessToken) => deps.google.client.deleteEvent(accessToken, googleCalendarId, googleEventId),
      );
    }
    await deps.repos.scheduledBlocks.delete(request.userId, id);
    return reply.code(204).send();
  });
}
