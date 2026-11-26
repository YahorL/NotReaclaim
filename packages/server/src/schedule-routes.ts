import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeDesiredSchedule, startBlockPatch, stopBlockEndMs } from '@notreclaim/core';
import { NotFoundError, type ScheduledBlock, type UpdateScheduledBlockInput } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { isMirrored, prefetchAccessToken, removeMirroredEventWithToken, type PrefetchedToken } from './google-writeback.js';
import { discardUnstartedPastBlocks } from './manual-sweep.js';
import { resolveRange } from './range.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema, createScheduledBlockSchema } from './schemas.js';
import { dataChanged } from './events.js';

/**
 * Every block write below runs its read-modify-write under `deps.withUserLock`, the same
 * per-user lock a replan holds around its compute + apply (server.ts). An edit that arrives
 * mid-replan therefore WAITS and lands on top of the replan's result, instead of being
 * overwritten, swept or pushed stale to Google by a plan read before it. Inside the lock:
 * only DB work and, for DELETE, its one Google call. Outside: request parsing, the Google
 * token lookup, announcements and the follow-up replan (which takes the lock itself, so it
 * must never be awaited while holding it).
 */
export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };
  // A block write can create, move, start, stop or remove time already spent, so it changes the
  // tasks' spentMs as well as the schedule.
  const announceBlockWrite = (userId: string) => deps.events.emit(dataChanged(userId, 'schedule', 'tasks'));

  app.get('/schedule', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(request.userId);

    // Manual mode: discard past task blocks that were never started (self-heal on load).
    if (settings?.requireStartToTrack) {
      const discarded = await discardUnstartedPastBlocks(app, deps, request.userId, now);
      // Only when a row actually went: the refetch this triggers in every tab finds nothing
      // left to discard, so it cannot loop. Un-started blocks never count as spent time in
      // manual mode, so tasks are unaffected.
      if (discarded > 0) deps.events.emit(dataChanged(request.userId, 'schedule'));
    }

    const { start, end } = await resolveRange(query, () => now, async () => settings?.horizonDays);
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });

  app.get('/schedule/preview', guard, async (request) => {
    return computeDesiredSchedule(deps.repos, request.userId, deps.now());
  });

  // Not afterMutation/replanAfterMutation: those swallow errors, and this route must surface
  // them (e.g. 502 on a Google failure). Emit only once the replan has succeeded.
  app.post('/schedule/replan', guard, async (request) => {
    const counts = await deps.replan(request.userId, deps.now());
    deps.events.emit({ type: 'schedule.updated', userId: request.userId, counts });
    return counts;
  });

  app.post('/schedule', guard, async (request, reply) => {
    const body = createScheduledBlockSchema.parse(request.body);
    const task = await deps.repos.tasks.findById(request.userId, body.taskId);
    if (!task) throw new NotFoundError(`Task ${body.taskId} not found`);
    const block = await deps.withUserLock(request.userId, () => deps.repos.scheduledBlocks.create(request.userId, {
      taskId: task.id, title: task.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: true,
    }));
    announceBlockWrite(request.userId);
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
    const block = await deps.withUserLock(request.userId, () => deps.repos.scheduledBlocks.update(request.userId, id, data));
    announceBlockWrite(request.userId);
    afterMutation(request.userId);
    return block;
  });

  /**
   * Start/Stop: the clock is read at ARRIVAL (the click is the user's intent, however long the
   * request then waits for the lock); the row is read, the new times computed from it and
   * written back, all under the lock. 404 for an unknown block; a non-task block gets a 400.
   */
  const timerRoute = (
    verb: 'started' | 'stopped',
    patch: (row: ScheduledBlock, now: number) => UpdateScheduledBlockInput,
  ) => async (request: FastifyRequest, reply: FastifyReply) => {
    const now = deps.now();
    const { id } = idParamSchema.parse(request.params);
    const block = await deps.withUserLock(request.userId, async () => {
      const row = await deps.repos.scheduledBlocks.findById(request.userId, id);
      if (!row) throw new NotFoundError(`ScheduledBlock ${id} not found`);
      if (!row.taskId) return null;
      return deps.repos.scheduledBlocks.update(request.userId, row.id, patch(row, now));
    });
    if (!block) return reply.code(400).send({ code: 'bad_request', message: `Only task blocks can be ${verb}` });
    announceBlockWrite(request.userId);
    afterMutation(request.userId);
    return block;
  };

  app.post('/schedule/:id/start', guard, timerRoute('started', (row, now) => startBlockPatch(row.startsAt.getTime(), row.endsAt.getTime(), now)));

  app.post('/schedule/:id/stop', guard, timerRoute('stopped', (row, now) => ({
    endsAt: new Date(stopBlockEndMs(row.startsAt.getTime(), row.endsAt.getTime(), now)), pinned: true,
  })));

  app.delete('/schedule/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { userId } = request;
    // No reconcile here: deleting a block clears it from the planner. The task (if any)
    // stays in Priorities and only reappears on an explicit re-plan. Skipping reconcile
    // does mean nothing else will ever sweep the mirrored event, so remove it here —
    // best-effort, exactly like the calendar routes: a Google failure must not block the
    // local delete, and a row with no Google ids never even looks up a token.
    // On a Google failure the row still goes, so the Google copy may be orphaned on the
    // Auto-scheduled calendar: the helper logs it.
    //
    // Peek first (unlocked) only to decide whether a token is needed, and look it up before
    // taking the lock. Under the lock: re-read, Google delete, row delete — a replan can
    // never run between the two deletes (it would PUT to the event just removed).
    const peek = await deps.repos.scheduledBlocks.findById(userId, id);
    if (!peek) throw new NotFoundError(`ScheduledBlock ${id} not found`);
    const onFailure = { fields: { blockId: id }, message: 'google write-back failed: block event not removed remotely' };

    const deleteUnderLock = (token: PrefetchedToken | null) => deps.withUserLock(userId, async () => {
      const row = await deps.repos.scheduledBlocks.findById(userId, id);
      // Removed while this waited (a replan's sweep, or drift after the user deleted the
      // event in Google): the user's delete has nothing left to do — and still succeeded.
      if (!row) return 'done';
      // Mirrored by a replan while this waited (first reconcile after linking Google), but no
      // token was fetched: let go of the lock and come back with one.
      if (isMirrored(row) && !token) return 'needs-token';
      if (token) await removeMirroredEventWithToken(app, deps, token, row, onFailure);
      try {
        await deps.repos.scheduledBlocks.delete(userId, id);
      } catch (err) {
        // Drift (which runs outside the lock) removed it after the read above: still deleted.
        if (!(err instanceof NotFoundError)) throw err;
      }
      return 'done';
    });

    const first = await deleteUnderLock(isMirrored(peek) ? await prefetchAccessToken(deps, userId) : null);
    if (first === 'needs-token') await deleteUnderLock(await prefetchAccessToken(deps, userId));
    // Still no replan — just tell the other tabs (there are no replan counts to report).
    announceBlockWrite(userId);
    return reply.code(204).send();
  });
}
