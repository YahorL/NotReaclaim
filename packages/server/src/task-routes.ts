import type { FastifyInstance } from 'fastify';
import { computeSpentMs, isFrozenTaskRow } from '@notreclaim/core';
import { NotFoundError, type CategoryRepository, type ScheduledBlock, type Settings } from '@notreclaim/db';
import { prefetchAccessToken, type PrefetchedToken } from './google-writeback.js';
import { endRunningPiecesUnderLock, prefetchForEnding } from './running-pieces.js';
import type { AppDeps, AfterMutation } from './app.js';
import { dataChanged } from './events.js';
import { ZodError } from 'zod';
import {
  createTaskSchema, updateTaskSchema, listTasksQuerySchema, idParamSchema, CHUNK_ORDER,
} from './schemas.js';

/**
 * A client-supplied categoryId must name one of the caller's own categories: an unknown id
 * would otherwise hit the FK as an untranslated 500, and another user's id would be accepted.
 * null (clear) and undefined (absent) pass through.
 */
async function assertOwnCategory(
  categories: Pick<CategoryRepository, 'listByUser'>, userId: string, categoryId: string | null | undefined,
): Promise<void> {
  if (categoryId == null) return;
  const owned = await categories.listByUser(userId);
  if (!owned.some((c) => c.id === categoryId)) throw new NotFoundError(`Category ${categoryId} not found for user`);
}

/** A task in one of these statuses has left the plan: nothing more is worked on it. */
const LEAVES_PLAN: ReadonlySet<string> = new Set(['completed', 'backlog', 'archived']);

/**
 * A task that leaves the plan (completed, backlogged or archived) while one of its pieces is
 * running ends that piece now, so the rest of it is freed for other work instead of staying busy
 * until its planned end and counting as time spent on a task that is done. Which pieces: those
 * that count or hold their place — every running piece of the task in automatic tracking
 * (frozen or pinned), the pinned (Started, dragged) ones in manual tracking, where an un-started
 * piece is simply swept by the replan. A piece that ran SHORT_PIECE_MS or more gets Stop's write;
 * a shorter one is deleted with its Google event (running-pieces.ts). The tracking mode is read
 * under the lock, with the write; returns how many pieces changed.
 */
async function endTaskRunningPieces(
  app: FastifyInstance, deps: AppDeps, userId: string, taskId: string, now: number,
): Promise<number> {
  const targetFor = (settings: Settings | null) => (b: ScheduledBlock) =>
    b.taskId === taskId && (b.pinned || (settings != null && isFrozenTaskRow(b, now, settings.requireStartToTrack)));
  const attempt = (token: PrefetchedToken | null) => deps.withUserLock(userId, async () =>
    endRunningPiecesUnderLock(app, deps, userId, now, targetFor(await deps.repos.settings.getByUserId(userId)), token));
  const first = await attempt(await prefetchForEnding(deps, userId, now, targetFor(await deps.repos.settings.getByUserId(userId))));
  if (first !== 'needs-token') return first;
  // A piece to delete got a Google event while this waited: come back once with a token.
  const second = await attempt(await prefetchAccessToken(deps, userId));
  return second === 'needs-token' ? 0 : second; // unreachable: a token was passed
}

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  const attachSpent = async (userId: string, tasks: Array<{ id: string }>) => {
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(userId);
    const requireStart = settings?.requireStartToTrack ?? false;
    const blocks = await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(now));
    return tasks.map((t) => ({ ...t, spentMs: computeSpentMs(t.id, blocks, requireStart, now) }));
  };

  app.post('/tasks', guard, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    await assertOwnCategory(deps.repos.categories, request.userId, body.categoryId);
    const task = await deps.repos.tasks.create(request.userId, {
      ...body,
      dueBy: body.dueBy ? new Date(body.dueBy) : null,
      notBefore: body.notBefore ? new Date(body.notBefore) : null,
    });
    afterMutation(request.userId, { taskId: task.id, action: 'created' });
    reply.code(201);
    return task;
  });

  app.get('/tasks', guard, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    const cutoff = new Date(deps.now() - 30 * 24 * 60 * 60 * 1000);
    // Announce only a purge that removed something, so the refetch it triggers can't loop.
    // Purged tasks cascade-delete their blocks, so the schedule changes too.
    if ((await deps.repos.tasks.purgeCompletedBefore(request.userId, cutoff)) > 0) {
      deps.events.emit(dataChanged(request.userId, 'tasks', 'schedule'));
    }
    const tasks = await deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
    return attachSpent(request.userId, tasks);
  });

  app.get('/tasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const task = await deps.repos.tasks.findById(request.userId, id);
    if (!task) throw new NotFoundError(`Task ${id} not found`);
    const [withSpent] = await attachSpent(request.userId, [task]);
    return withSpent;
  });

  app.patch('/tasks/:id', guard, async (request) => {
    const now = deps.now();
    const { id } = idParamSchema.parse(request.params);
    const { dueBy: dueByStr, notBefore: nbStr, ...rest } = updateTaskSchema.parse(request.body);
    await assertOwnCategory(deps.repos.categories, request.userId, rest.categoryId);
    if (rest.minChunkMs !== undefined || rest.maxChunkMs !== undefined) {
      const stored = await deps.repos.tasks.findById(request.userId, id);
      if (!stored) throw new NotFoundError(`Task ${id} not found`);
      if ((rest.minChunkMs ?? stored.minChunkMs) > (rest.maxChunkMs ?? stored.maxChunkMs)) {
        throw new ZodError([{ code: 'custom', ...CHUNK_ORDER }]);
      }
    }
    const data = {
      ...rest,
      ...(dueByStr !== undefined ? { dueBy: dueByStr === null ? null : new Date(dueByStr) } : {}),
      ...(nbStr !== undefined ? { notBefore: nbStr === null ? null : new Date(nbStr) } : {}),
      ...(rest.status !== undefined
        ? { completedAt: rest.status === 'completed' ? new Date(now) : null }
        : {}),
    };
    const task = await deps.repos.tasks.update(request.userId, id, data);
    if (rest.status !== undefined && LEAVES_PLAN.has(rest.status)) {
      // A block write: it changes the schedule and the task's spentMs.
      if ((await endTaskRunningPieces(app, deps, request.userId, id, now)) > 0) {
        deps.events.emit(dataChanged(request.userId, 'schedule', 'tasks'));
      }
    }
    afterMutation(request.userId, { taskId: id, action: 'updated' });
    return task;
  });

  app.delete('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.tasks.delete(request.userId, id);
    afterMutation(request.userId, { taskId: id, action: 'deleted' });
    return reply.code(204).send();
  });
}
