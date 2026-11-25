import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeDesiredSchedule, startBlockPatch, stopBlockEndMs } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { bestEffortGoogleWrite } from './google-writeback.js';
import { resolveRange } from './range.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema, createScheduledBlockSchema } from './schemas.js';
import { dataChanged } from './events.js';

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
      const past = await deps.repos.scheduledBlocks.listByUserInRange(request.userId, new Date(0), new Date(now));
      let discarded = 0;
      for (const b of past) {
        if (b.taskId && b.startedAt == null && b.endsAt.getTime() <= now) {
          // Row first: an overlapping GET may have discarded it already (it then owns the
          // Google delete too), which must not fail this request.
          try {
            await deps.repos.scheduledBlocks.delete(request.userId, b.id);
          } catch (err) {
            if (err instanceof NotFoundError) continue;
            throw err;
          }
          discarded++;
          // Remove the mirrored event too: nothing else ever will (reconcile only deletes
          // events of rows it still holds, and drift only lists [now, horizon]). Best-effort
          // and per row, same as DELETE /schedule/:id — a Google failure never fails the GET.
          const { googleEventId, googleCalendarId } = b;
          if (googleEventId && googleCalendarId) {
            await bestEffortGoogleWrite(
              app, deps, request.userId,
              { fields: { blockId: b.id }, message: 'google write-back failed: discarded block event not removed remotely' },
              (accessToken) => deps.google.client.deleteEvent(accessToken, googleCalendarId, googleEventId),
            );
          }
        }
      }
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
    const counts = await deps.reconcile(request.userId, deps.now());
    deps.events.emit({ type: 'schedule.updated', userId: request.userId, counts });
    return counts;
  });

  app.post('/schedule', guard, async (request, reply) => {
    const body = createScheduledBlockSchema.parse(request.body);
    const task = await deps.repos.tasks.findById(request.userId, body.taskId);
    if (!task) throw new NotFoundError(`Task ${body.taskId} not found`);
    const block = await deps.repos.scheduledBlocks.create(request.userId, {
      taskId: task.id, title: task.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: true,
    });
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
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    announceBlockWrite(request.userId);
    afterMutation(request.userId);
    return block;
  });

  /** Start/Stop prelude: 404 for an unknown block; a non-task block gets a 400 and null back. */
  const loadTaskBlock = async (request: FastifyRequest, reply: FastifyReply, verb: 'started' | 'stopped') => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) throw new NotFoundError(`ScheduledBlock ${id} not found`);
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: `Only task blocks can be ${verb}` });
      return null;
    }
    return blockRow;
  };

  app.post('/schedule/:id/start', guard, async (request, reply) => {
    const blockRow = await loadTaskBlock(request, reply, 'started');
    if (!blockRow) return;
    const block = await deps.repos.scheduledBlocks.update(
      request.userId, blockRow.id, startBlockPatch(blockRow.endsAt.getTime(), deps.now()),
    );
    announceBlockWrite(request.userId);
    afterMutation(request.userId);
    return block;
  });

  app.post('/schedule/:id/stop', guard, async (request, reply) => {
    const blockRow = await loadTaskBlock(request, reply, 'stopped');
    if (!blockRow) return;
    const newEnd = stopBlockEndMs(blockRow.startsAt.getTime(), blockRow.endsAt.getTime(), deps.now());
    const block = await deps.repos.scheduledBlocks.update(request.userId, blockRow.id, { endsAt: new Date(newEnd), pinned: true });
    announceBlockWrite(request.userId);
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
    // Still no replan — just tell the other tabs (there are no replan counts to report).
    announceBlockWrite(request.userId);
    return reply.code(204).send();
  });
}
