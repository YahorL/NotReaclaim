import { describe, it, expect } from 'vitest';
import type { Category, ScheduledBlock, Task } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

const taskBody = {
  title: 'Write report', priority: 1, durationMs: 3600000,
  dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000,
};

describe('task routes', () => {
  it('creates, fetches, lists, updates, and deletes a task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const got = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe('Write report');

    const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth });
    expect(list.json()).toHaveLength(1);

    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 5 } });
    expect(patched.json().priority).toBe(5);

    const del = await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('returns 404 for a missing task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid body with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: { title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('scopes tasks by user', async () => {
    const { app } = buildTestApp();
    const tokenA = await tokenFor(app, 'userA');
    const tokenB = await tokenFor(app, 'userB');
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${tokenA}` }, payload: taskBody });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a missing task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/tasks/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('emits task.changed (created) and triggers a re-plan on create', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({
      method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: taskBody,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'created' });
    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
  });

  it('emits task.changed (updated) on patch and (deleted) on delete', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody })).json().id;

    await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 4 } });
    await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'updated' });
    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'deleted' });
    expect(reconcileCalls).toHaveLength(3); // create + patch + delete
  });

  it('does not emit or re-plan on GET', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });

    expect(emitted).toEqual([]);
    expect(reconcileCalls).toEqual([]);
  });

  it('round-trips categoryId on task create and update', async () => {
    const { app } = buildTestApp({
      categories: ['cat-1', 'cat-2'].map((id) => ({
        id, userId: 'u1', name: id, windows: null, color: null, isDefault: false, createdAt: new Date(0), updatedAt: new Date(0),
      }) as Category),
    });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const createRes = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId: 'cat-1' } });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json()).toMatchObject({ categoryId: 'cat-1' });
    const id = (createRes.json() as { id: string }).id;
    const patchRes = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { categoryId: 'cat-2' } });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({ categoryId: 'cat-2' });
  });

  it('persists notBefore on create and clears it on update', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const payload = { title: 'T', priority: 1, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000, notBefore: '2026-01-06T13:00:00.000Z' };
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ notBefore: '2026-01-06T13:00:00.000Z' });
    const id = (res.json() as { id: string }).id;
    const patch = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { notBefore: null } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ notBefore: null });
  });

  it('creates a task with no due date when dueBy is omitted', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const authHeader = { authorization: `Bearer ${token}` };
    const res = await app.inject({
      method: 'POST', url: '/tasks', headers: authHeader,
      payload: { title: 'Someday', priority: 3, durationMs: 3_600_000, minChunkMs: 900_000, maxChunkMs: 1_800_000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dueBy).toBeNull();
  });

  it('creates a task with no due date when dueBy is explicitly null', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const authHeader = { authorization: `Bearer ${token}` };
    const res = await app.inject({
      method: 'POST', url: '/tasks', headers: authHeader,
      payload: { title: 'Someday', priority: 3, durationMs: 3_600_000, minChunkMs: 900_000, maxChunkMs: 1_800_000, dueBy: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dueBy).toBeNull();
  });

  it('clears an existing due date when PATCHed with null', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const authHeader = { authorization: `Bearer ${token}` };
    const existingTaskId = (await app.inject({ method: 'POST', url: '/tasks', headers: authHeader, payload: taskBody })).json().id;
    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${existingTaskId}`, headers: authHeader,
      payload: { dueBy: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dueBy).toBeNull();
  });

  it('leaves the due date untouched when PATCH omits dueBy', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const authHeader = { authorization: `Bearer ${token}` };
    const existingTaskId = (await app.inject({ method: 'POST', url: '/tasks', headers: authHeader, payload: taskBody })).json().id;
    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${existingTaskId}`, headers: authHeader,
      payload: { title: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    // Exact value, not just non-null: writing a DIFFERENT date would also be a bug.
    expect(res.json().dueBy).toBe(taskBody.dueBy);
  });

  it('rejects a non-datetime notBefore with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'T', priority: 1, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000, notBefore: 'not-a-date' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('passes sortOrder through create and patch', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` },
      payload: { title: 'T', priority: 4, durationMs: 60_000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 60_000, maxChunkMs: 60_000, sortOrder: 2.5 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().sortOrder).toBe(2.5);
    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${created.json().id}`, headers: { authorization: `Bearer ${token}` }, payload: { sortOrder: 0.5 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().sortOrder).toBe(0.5);
  });

  it('PATCH status completed sets completedAt, un-complete clears it', async () => {
    const { app, FIXED_NOW } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    const id = created.json().id;

    // Complete: completedAt should be set to now
    const completed = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { status: 'completed' } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().completedAt).toBe(new Date(FIXED_NOW).toISOString());

    // Un-complete: completedAt should be cleared
    const pending = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { status: 'pending' } });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().completedAt).toBeNull();
  });

  it('PATCH accepts backlog status', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    const id = created.json().id;
    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { status: 'backlog' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('backlog');
    expect(patched.json().completedAt).toBeNull();
  });

  it('GET /tasks filters by backlog status', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    const list = await app.inject({ method: 'GET', url: '/tasks?status=backlog', headers: auth });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(0); // task is pending, not backlog
  });

  it('GET /tasks purges old completed tasks (>30 days) but keeps recent ones', async () => {
    // FIXED_NOW = 2026-01-05T00:00:00.000Z
    const THIRTY_ONE_DAYS_AGO = new Date('2025-12-05T00:00:00.000Z');
    const FIVE_DAYS_AGO = new Date('2025-12-31T00:00:00.000Z');

    const oldCompleted = {
      id: 'old-done', userId: 'u1', title: 'old', priority: 1, sortOrder: 0,
      durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1,
      categoryId: null, notBefore: null, status: 'completed', completedAt: THIRTY_ONE_DAYS_AGO,
      timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
    } as unknown as import('@notreclaim/db').Task;

    const recentCompleted = {
      id: 'recent-done', userId: 'u1', title: 'recent', priority: 1, sortOrder: 0,
      durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1,
      categoryId: null, notBefore: null, status: 'completed', completedAt: FIVE_DAYS_AGO,
      timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
    } as unknown as import('@notreclaim/db').Task;

    const { app } = buildTestApp({ tasks: [oldCompleted, recentCompleted] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };

    const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth });
    expect(list.statusCode).toBe(200);
    const ids = list.json().map((t: { id: string }) => t.id);
    expect(ids).not.toContain('old-done');
    expect(ids).toContain('recent-done');
  });
});

describe('GET /tasks spentMs', () => {
  const taskRow = {
    id: 't1', userId: 'u1', title: 'T', priority: 1, sortOrder: 0, durationMs: 3_600_000,
    dueBy: new Date('2026-01-09T17:00:00.000Z'), notBefore: null, minChunkMs: 1, maxChunkMs: 1,
    categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
    createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
  };
  const finished: ScheduledBlock = {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'T',
    startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), // 30m, finished
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const settingsRow = (requireStartToTrack: boolean) => ({
    id: 's', userId: 'u1', timezone: 'UTC', workingHours: [], horizonDays: 14,
    defaultMinChunkMs: 1, defaultMaxChunkMs: 1, meetingBufferMs: 0, taskBufferMs: 0,
    requireStartToTrack, createdAt: new Date(0), updatedAt: new Date(0),
  });

  it('reports auto-mode spent from finished blocks', async () => {
    const { app } = buildTestApp({ tasks: [taskRow as never], blocks: [finished], settings: settingsRow(false) as never });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()[0].spentMs).toBe(1_800_000);
  });

  it('manual mode counts only started finished blocks', async () => {
    const { app } = buildTestApp({ tasks: [taskRow as never], blocks: [finished], settings: settingsRow(true) as never });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()[0].spentMs).toBe(0); // finished but un-started → not counted
  });
});

describe('categoryId ownership', () => {
  const cat = (id: string, userId: string) =>
    ({ id, userId, name: id, windows: null, color: null, isDefault: false, createdAt: new Date(0), updatedAt: new Date(0) }) as Category;
  const setup = async () => {
    const ctx = buildTestApp({ categories: [cat('cat-mine', 'u1'), cat('cat-theirs', 'other')] });
    const auth = { authorization: `Bearer ${await tokenFor(ctx.app)}` };
    return { ...ctx, auth };
  };

  const rejected = [
    { label: 'an unknown category id', categoryId: 'cat-missing' },
    { label: "another user's category id", categoryId: 'cat-theirs' },
  ];

  it.each(rejected)('POST /tasks 404s for $label and stores nothing', async ({ categoryId }) => {
    const { app, auth, reconcileCalls } = await setup();
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/tasks', headers: auth })).json()).toHaveLength(0);
    expect(reconcileCalls).toEqual([]);
  });

  it.each(rejected)('PATCH /tasks/:id 404s for $label and leaves the task unchanged', async ({ categoryId }) => {
    const { app, auth } = await setup();
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId: 'cat-mine' } })).json().id;
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { categoryId, priority: 9 } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
    const got = (await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth })).json();
    expect(got).toMatchObject({ categoryId: 'cat-mine', priority: 1 });
  });

  it('accepts the user\'s own category, null (clear) and an absent field', async () => {
    const { app, auth } = await setup();
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId: 'cat-mine' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const absent = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 2 } });
    expect(absent.json().categoryId).toBe('cat-mine');
    const cleared = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { categoryId: null } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().categoryId).toBeNull();
    const set = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { categoryId: 'cat-mine' } });
    expect(set.json().categoryId).toBe('cat-mine');
    const createdNull = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId: null } });
    expect(createdNull.statusCode).toBe(201);
  });
});

describe('min/max chunk order', () => {
  const M = 60_000;
  // A row stored with min > max before the server checked chunk order (or written out of band).
  const conflicting = {
    id: 'task-legacy', userId: 'u1', title: 'Legacy', priority: 1, sortOrder: 0,
    durationMs: 90 * M, dueBy: null, notBefore: null, minChunkMs: 60 * M, maxChunkMs: 30 * M,
    categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
  } as Task;
  const setup = async (tasks: Task[] = []) => {
    const ctx = buildTestApp({ tasks });
    return { ...ctx, auth: { authorization: `Bearer ${await tokenFor(ctx.app)}` } };
  };

  it('POST /tasks rejects minChunkMs > maxChunkMs with 400 validation_error', async () => {
    const { app, auth, reconcileCalls } = await setup();
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, minChunkMs: 1800001, maxChunkMs: 1800000 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_error');
    expect(reconcileCalls).toEqual([]);
  });

  it('POST /tasks accepts minChunkMs = maxChunkMs', async () => {
    const { app, auth } = await setup();
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, minChunkMs: 1800000, maxChunkMs: 1800000 } });
    expect(res.statusCode).toBe(201);
  });

  it('PATCH /tasks/:id rejects a patch whose min and max conflict', async () => {
    const { app, auth } = await setup();
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody })).json().id;
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { minChunkMs: 60 * M, maxChunkMs: 30 * M } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_error');
  });

  it('PATCH /tasks/:id rejects min alone above the stored max (and max alone below the stored min)', async () => {
    const { app, auth } = await setup();
    // taskBody: min 15m, max 30m.
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody })).json().id;
    const minOnly = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { minChunkMs: 45 * M } });
    expect(minOnly.statusCode).toBe(400);
    expect(minOnly.json().code).toBe('validation_error');
    const maxOnly = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { maxChunkMs: 10 * M } });
    expect(maxOnly.statusCode).toBe(400);
    const got = (await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth })).json();
    expect(got).toMatchObject({ minChunkMs: 15 * M, maxChunkMs: 30 * M });
  });

  it('PATCH /tasks/:id that touches neither min nor max still works on a stored conflicting row', async () => {
    const { app, auth } = await setup([conflicting]);
    const res = await app.inject({ method: 'PATCH', url: '/tasks/task-legacy', headers: auth, payload: { title: 'Renamed', durationMs: 120 * M } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Renamed', minChunkMs: 60 * M, maxChunkMs: 30 * M });
  });

  it('PATCH /tasks/:id can repair a stored conflicting row by touching one side', async () => {
    const { app, auth } = await setup([conflicting]);
    const res = await app.inject({ method: 'PATCH', url: '/tasks/task-legacy', headers: auth, payload: { maxChunkMs: 90 * M } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ minChunkMs: 60 * M, maxChunkMs: 90 * M });
  });
});
