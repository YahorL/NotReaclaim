import { describe, it, expect } from 'vitest';
import type { ScheduledBlock, Settings } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'Focus',
    startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0',
    startedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}
function settings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1', userId: 'u1', timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
    horizonDays: 1, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 1800000,
    meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}

describe('schedule routes', () => {
  it('GET /schedule returns persisted blocks in the default range', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/schedule', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('GET /schedule/preview returns desired blocks + unscheduled', async () => {
    const { app } = buildTestApp({
      settings: settings(),
      tasks: [{
        id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1800000,
        dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1800000, maxChunkMs: 1800000,
        category: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
      }],
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/schedule/preview', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('blocks');
    expect(res.json()).toHaveProperty('unscheduled');
    expect(res.json().blocks.length).toBeGreaterThan(0);
  });

  it('POST /schedule/replan invokes reconcile and returns counts', async () => {
    const { app, reconcileCalls } = buildTestApp({ reconcileResult: { created: 2, updated: 1, deleted: 0, pinned: 0, removed: 0 } });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(2);
    expect(reconcileCalls).toHaveLength(1);
    expect(reconcileCalls[0]!.userId).toBe('u1');
  });

  it('GET /schedule/preview returns 409 when settings are not configured', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/schedule/preview', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(409);
  });

  it('PATCH /schedule/:id updates times+pinned, returns the block, and triggers a re-plan', async () => {
    const { app, emitted } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/b1',
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', pinned: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pinned).toBe(true);
    expect(res.json().startsAt).toBe('2026-01-05T11:00:00.000Z');
    expect(emitted.some((e) => e.type === 'schedule.updated')).toBe(true);
  });

  it('PATCH /schedule/:id returns 404 for a block the user does not own', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/does-not-exist',
      headers: { authorization: `Bearer ${token}` },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /schedule/:id removes the block and returns 204', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const del = await app.inject({ method: 'DELETE', url: '/schedule/b1', headers: { authorization: `Bearer ${token}` } });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/schedule', headers: { authorization: `Bearer ${token}` } });
    expect(list.json()).toHaveLength(0);
  });

  it('DELETE /schedule/:id 404s for a block the user does not own', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/schedule/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /schedule/:id rejects startsAt >= endsAt with 400', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/b1',
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-01-05T12:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /schedule', () => {
  const seedTask = { id: 'task-1', userId: 'u1', title: 'Deep work', priority: 2, durationMs: 3_600_000,
    dueBy: new Date('2026-01-09T17:00:00.000Z'), minChunkMs: 3_600_000, maxChunkMs: 3_600_000, categoryId: null,
    notBefore: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [] };
  const body = { taskId: 'task-1', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z' };

  it('creates a pinned block for an owned task, reflows, 201', async () => {
    const { app, reconcileCalls } = buildTestApp({ tasks: [seedTask as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ taskId: 'task-1', title: 'Deep work', pinned: true, engineKey: null });
    expect(reconcileCalls.length).toBeGreaterThan(0);
  });

  it('404s for a task that is not yours', async () => {
    const { app } = buildTestApp({ tasks: [{ ...seedTask, userId: 'someone-else' } as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it('400s an inverted range', async () => {
    const { app } = buildTestApp({ tasks: [seedTask as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: { ...body, endsAt: '2026-01-06T08:00:00.000Z' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /schedule/:id/start', () => {
  const FIXED = Date.parse('2026-01-05T00:00:00.000Z'); // FIXED_NOW from fakes (Monday 00:00 UTC)

  it('late start snaps startsAt to the nearest 15 min, pins, sets startedAt', async () => {
    // FIXED_NOW rounds to 00:00; block 23:50→01:00 spans it so the snap (00:00) lands inside.
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:50:00.000Z'), endsAt: new Date('2026-01-05T01:00:00.000Z') });
    const { app, reconcileCalls } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T00:00:00.000Z'); // snapped to FIXED_NOW
    expect(res.json().pinned).toBe(true);
    expect(res.json().startedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(reconcileCalls.length).toBeGreaterThan(0);
  });

  it('pulls an upcoming block start to the snapped current time, keeping the end', async () => {
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T02:00:00.000Z'), endsAt: new Date('2026-01-05T03:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T00:00:00.000Z'); // FIXED_NOW (00:00) snapped → pulled forward
    expect(res.json().endsAt).toBe('2026-01-05T03:00:00.000Z');   // end unchanged
    expect(res.json().pinned).toBe(true);
  });

  it('404s an unknown block and 400s a habit block', async () => {
    const habitBlock = block({ id: 'h1', taskId: null, habitId: 'hab1' });
    const { app } = buildTestApp({ blocks: [habitBlock], settings: settings() });
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'POST', url: '/schedule/none/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/schedule/h1/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
  });
});

describe('GET /schedule discard sweep (manual mode)', () => {
  const wide = '?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z';

  it('deletes past un-started task blocks but keeps started and future ones', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), startedAt: null });
    const kept = block({ id: 'kept', startsAt: new Date('2026-01-04T10:00:00.000Z'), endsAt: new Date('2026-01-04T10:30:00.000Z'), startedAt: new Date('2026-01-04T10:00:00.000Z') });
    const future = block({ id: 'future', startsAt: new Date('2026-01-06T09:00:00.000Z'), endsAt: new Date('2026-01-06T09:30:00.000Z'), startedAt: null });
    const { app } = buildTestApp({ blocks: [missed, kept, future], settings: settings({ requireStartToTrack: true }) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    const ids = (res.json() as { id: string }[]).map((b) => b.id).sort();
    expect(ids).toEqual(['future', 'kept']);
  });

  it('keeps un-started past blocks in auto mode', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), startedAt: null });
    const { app } = buildTestApp({ blocks: [missed], settings: settings({ requireStartToTrack: false }) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect((res.json() as unknown[]).length).toBe(1);
  });
});
