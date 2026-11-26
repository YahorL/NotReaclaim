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
      createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
    } as unknown as import('@notreclaim/db').Task;

    const recentCompleted = {
      id: 'recent-done', userId: 'u1', title: 'recent', priority: 1, sortOrder: 0,
      durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1,
      categoryId: null, notBefore: null, status: 'completed', completedAt: FIVE_DAYS_AGO,
      createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
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
    categoryId: null, status: 'pending', completedAt: null,
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
    categoryId: null, status: 'pending', completedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
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

describe('PATCH /tasks/:id taking a task out of the plan while one of its pieces runs', () => {
  const NOW = Date.parse('2026-01-05T09:37:00.000Z'); // round15 → 09:30
  const iso = (hm: string) => new Date(`2026-01-05T${hm}:00.000Z`);
  const taskRow = (id: string): Task => ({
    id, userId: 'u1', title: id, priority: 1, sortOrder: 0, durationMs: 7_200_000, dueBy: null, notBefore: null,
    minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending', completedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  });
  const blockRow = (over: Partial<ScheduledBlock>): ScheduledBlock => ({
    id: 'b', userId: 'u1', taskId: 't1', habitId: null, title: 't1', startsAt: iso('09:00'), endsAt: iso('10:00'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  });
  const settingsRow = (requireStartToTrack: boolean) => ({
    id: 's1', userId: 'u1', timezone: 'UTC', workingHours: [] as never, horizonDays: 7,
    defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 3_600_000, meetingBufferMs: 0, taskBufferMs: 0,
    requireStartToTrack, dayStartMinute: 0, createdAt: new Date(0), updatedAt: new Date(0),
  });
  const blocks = () => [
    blockRow({ id: 'running', engineKey: 'task:t1:0' }), // the frozen auto piece, never Started
    blockRow({ id: 'started', pinned: true, startedAt: iso('09:00'), startsAt: iso('09:15'), endsAt: iso('10:15') }), // Started
    blockRow({ id: 'later', engineKey: 'task:t1:1', startsAt: iso('10:00'), endsAt: iso('11:00') }), // not begun
    blockRow({ id: 'done', engineKey: null, startsAt: iso('08:00'), endsAt: iso('08:30') }), // finished
    blockRow({ id: 'other', taskId: 't2', engineKey: 'task:t2:0' }), // another task's running piece
  ];

  async function patch(status: string, requireStartToTrack = false, payload: Record<string, unknown> = { status }) {
    const ctx = buildTestApp({ tasks: [taskRow('t1'), taskRow('t2')], blocks: blocks(), settings: settingsRow(requireStartToTrack), now: () => NOW });
    const token = await tokenFor(ctx.app);
    const res = await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload });
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    return { res, byId, ctx };
  }

  it.each(['completed', 'backlog', 'archived'])('automatic tracking, %s: every running piece of the task ends at round15(now) and is pinned, like Stop', async (status) => {
    const { res, byId, ctx } = await patch(status);
    expect(res.statusCode).toBe(200);
    expect(byId('running')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:30'), pinned: true, startedAt: null });
    expect(byId('started')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:30'), pinned: true }); // start + 15 min floor
    // Untouched: a piece that has not begun (the replan sweeps it), a finished one, another task's.
    expect(byId('later')).toMatchObject({ endsAt: iso('11:00'), pinned: false });
    expect(byId('done')).toMatchObject({ endsAt: iso('08:30'), pinned: false });
    expect(byId('other')).toMatchObject({ endsAt: iso('10:00'), pinned: false });
    expect(ctx.emitted).toContainEqual(expect.objectContaining({ type: 'data.changed', userId: 'u1', resources: ['schedule', 'tasks'] }));
    expect(ctx.reconcileCalls).toHaveLength(1); // then the usual replan, which re-plans the freed time
  });

  it.each(['completed', 'backlog', 'archived'])('manual tracking, %s: the Started running piece ends too; an un-started one is left to the replan', async (status) => {
    const { byId } = await patch(status, true);
    expect(byId('started')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:30'), pinned: true });
    expect(byId('running')).toMatchObject({ endsAt: iso('10:00'), pinned: false }); // never counted; the replan sweeps it
  });

  describe('a piece ended less than 7.5 minutes after its start is deleted, with its Google event', () => {
    const run = async (now: number) => {
      const deleted: string[] = [];
      const ctx = buildTestApp({
        tasks: [taskRow('t1')], settings: settingsRow(false), now: () => now, accessToken: 'access-1',
        blocks: [blockRow({ id: 'p', engineKey: 'task:t1:0', googleEventId: 'g-p', googleCalendarId: 'cal-auto' })],
        deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
      });
      const token = await tokenFor(ctx.app);
      const res = await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload: { status: 'completed' } });
      expect(res.statusCode).toBe(200);
      return { row: await ctx.scheduledBlocks.findById('u1', 'p'), deleted, ctx };
    };
    const after = (ms: number) => Date.parse('2026-01-05T09:00:00.000Z') + ms;

    it('at 7 min 29 s: the row and its event go', async () => {
      const { row, deleted, ctx } = await run(after(7 * 60_000 + 29_000));
      expect(row).toBeNull();
      expect(deleted).toEqual(['g-p']);
      expect(ctx.emitted).toContainEqual(expect.objectContaining({ type: 'data.changed', resources: ['schedule', 'tasks'] }));
    });

    it("at 7 min 30 s: Stop's write (a 15-minute piece), the event stays for the pinned pass to shorten", async () => {
      const { row, deleted } = await run(after(7 * 60_000 + 30_000));
      expect(row).toMatchObject({ endsAt: iso('09:15'), pinned: true });
      expect(deleted).toEqual([]);
    });

    it('well past: ended at round15(now)', async () => {
      const { row } = await run(after(37 * 60_000));
      expect(row).toMatchObject({ endsAt: iso('09:30'), pinned: true });
    });

    it('a piece mirrored by a replan while the request waited: it lets go, fetches a token, and comes back once', async () => {
      const deleted: string[] = [];
      let entries = 0;
      const ctx = buildTestApp({
        tasks: [taskRow('t1')], settings: settingsRow(false), now: () => after(60_000), accessToken: 'access-1',
        blocks: [blockRow({ id: 'p', engineKey: 'task:t1:0' })], // no event at the peek
        deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
        withUserLock: async (_u, fn) => {
          // The replan that held the lock gave the row its event.
          if (++entries === 1) await ctx.scheduledBlocks.update('u1', 'p', { googleEventId: 'g-p', googleCalendarId: 'cal-auto' });
          return fn();
        },
      });
      const token = await tokenFor(ctx.app);
      await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload: { status: 'completed' } });
      expect(entries).toBe(2);
      expect(deleted).toEqual(['g-p']);
      expect(await ctx.scheduledBlocks.findById('u1', 'p')).toBeNull();
    });

    it('the token is looked up before the lock, and only when a short piece has an event', async () => {
      let lookups = 0;
      let inLock = false;
      const ctx = buildTestApp({
        tasks: [taskRow('t1')], settings: settingsRow(false), now: () => after(60_000),
        blocks: [blockRow({ id: 'p', engineKey: 'task:t1:0', googleEventId: 'g-p', googleCalendarId: 'cal-auto' })],
        getAccessToken: async () => { lookups += 1; expect(inLock).toBe(false); return 'access-1'; },
        deleteEvent: async () => undefined,
        withUserLock: async (_u, fn) => { inLock = true; try { return await fn(); } finally { inLock = false; } },
      });
      const token = await tokenFor(ctx.app);
      await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload: { status: 'completed' } });
      expect(lookups).toBe(1);
      expect(await ctx.scheduledBlocks.findById('u1', 'p')).toBeNull();
    });
  });

  it.each([
    ['back to pending', { status: 'pending' }],
    ['a change that is not a status', { title: 'Renamed' }],
  ])('%s: no block is touched', async (_label, payload) => {
    const { byId, ctx } = await patch('', false, payload);
    expect(byId('running')).toMatchObject({ endsAt: iso('10:00'), pinned: false });
    expect(ctx.emitted.some((e) => e.type === 'data.changed')).toBe(false);
  });

  it('an unknown task: 404 and no block is touched', async () => {
    const ctx = buildTestApp({ tasks: [], blocks: blocks(), settings: settingsRow(false), now: () => NOW });
    const token = await tokenFor(ctx.app);
    const res = await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload: { status: 'completed' } });
    expect(res.statusCode).toBe(404);
    expect((await ctx.scheduledBlocks.findById('u1', 'running'))).toMatchObject({ endsAt: iso('10:00') });
  });

  it('the block writes run under the per-user lock (a replan in flight cannot interleave)', async () => {
    let inLock = false;
    const log: string[] = [];
    const ctx = buildTestApp({
      tasks: [taskRow('t1')], blocks: blocks(), settings: settingsRow(false), now: () => NOW,
      withUserLock: async (_u, fn) => { inLock = true; try { return await fn(); } finally { inLock = false; } },
    });
    const update = ctx.scheduledBlocks.update;
    ctx.scheduledBlocks.update = async (u, id, data) => { log.push(`${id}:${inLock}`); return update(u, id, data); };
    const token = await tokenFor(ctx.app);
    await ctx.app.inject({ method: 'PATCH', url: '/tasks/t1', headers: { authorization: `Bearer ${token}` }, payload: { status: 'completed' } });
    expect(log.sort()).toEqual(['running:true', 'started:true']);
  });
});
