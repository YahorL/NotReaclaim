import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Category, Habit, ScheduledBlock, Settings, Task } from '@notreclaim/db';
import { buildTestApp, tokenFor, type TestAppOptions } from './fakes.js';
import { createConnectionRegistry } from '../src/connection-registry.js';
import type { ServerEvent } from '../src/events.js';

/**
 * Every mutating route tells the user's OTHER tabs which cached lists changed via one
 * `data.changed` event, emitted straight after the route's own write — so it must fire even
 * when the follow-up replan fails, and never on a rejected (4xx) request.
 */

const settingsRow = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'utc',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
  horizonDays: 1, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 1800000,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, dayStartMinute: 0,
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
});
const taskRow = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'T', priority: 1, sortOrder: 0, durationMs: 1800000,
  dueBy: null, notBefore: null, minChunkMs: 1800000, maxChunkMs: 1800000, categoryId: null,
  status: 'pending', completedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...over,
}) as Task;
const habitRow: Habit = {
  id: 'h1', userId: 'u1', title: 'Gym', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5],
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, status: 'active',
  createdAt: new Date(0), updatedAt: new Date(0),
} as unknown as Habit;
const categoryRow = (over: Partial<Category> = {}): Category => ({
  id: 'c1', userId: 'u1', name: 'Personal', color: null, windows: null, isDefault: false,
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
}) as Category;
const eventRow: CalendarEvent = {
  id: 'e1', userId: 'u1', googleCalendarId: null, googleEventId: null, title: 'Standup', source: 'app', kind: 'event',
  startsAt: new Date('2026-01-05T10:00:00.000Z'), endsAt: new Date('2026-01-05T10:30:00.000Z'),
  createdAt: new Date(0), updatedAt: new Date(0),
};
const blockRow = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
  id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'Focus',
  startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
  pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0', startedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

const seed: TestAppOptions = {
  settings: settingsRow(),
  tasks: [taskRow()],
  habits: [habitRow],
  categories: [categoryRow(), categoryRow({ id: 'cdef', name: 'Working Hours', isDefault: true })],
  calendarEvents: [eventRow],
  blocks: [blockRow(), blockRow({ id: 'hb', taskId: null, habitId: 'h1', engineKey: 'habit:h1:0' })],
};

const dataChanged = (emitted: ServerEvent[]) => emitted.filter((e) => e.type === 'data.changed');

interface Case {
  name: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
  status: number;
  resources: string[];
}

const settingsBody = {
  timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000,
};
const habitBody = { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] };
const windows = [{ weekday: 1, startMinute: 1080, endMinute: 1320 }];
const eventBody = { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' };

const successCases: Case[] = [
  { name: 'POST /habits', method: 'POST', url: '/habits', payload: habitBody, status: 201, resources: ['habits', 'schedule'] },
  { name: 'PATCH /habits/:id', method: 'PATCH', url: '/habits/h1', payload: { title: 'Run' }, status: 200, resources: ['habits', 'schedule'] },
  { name: 'DELETE /habits/:id', method: 'DELETE', url: '/habits/h1', status: 204, resources: ['habits', 'schedule'] },
  { name: 'POST /categories', method: 'POST', url: '/categories', payload: { name: 'Gym', windows }, status: 201, resources: ['categories', 'schedule'] },
  { name: 'PATCH /categories/:id', method: 'PATCH', url: '/categories/c1', payload: { name: 'Home' }, status: 200, resources: ['categories', 'schedule'] },
  // Deleting a category nulls Task.categoryId (onDelete: SetNull), so the task list changes too.
  { name: 'DELETE /categories/:id', method: 'DELETE', url: '/categories/c1', status: 204, resources: ['categories', 'tasks', 'schedule'] },
  // requireStartToTrack changes every task's spentMs.
  { name: 'PUT /settings', method: 'PUT', url: '/settings', payload: settingsBody, status: 200, resources: ['settings', 'tasks', 'schedule'] },
  { name: 'POST /calendar/events', method: 'POST', url: '/calendar/events', payload: eventBody, status: 201, resources: ['calendarEvents', 'schedule'] },
  { name: 'PATCH /calendar/events/:id', method: 'PATCH', url: '/calendar/events/e1', payload: { title: 'Sync' }, status: 200, resources: ['calendarEvents', 'schedule'] },
  { name: 'DELETE /calendar/events/:id', method: 'DELETE', url: '/calendar/events/e1', status: 204, resources: ['calendarEvents', 'schedule'] },
  // Block writes can move a block into/out of the past, which changes the task's spentMs.
  { name: 'POST /schedule', method: 'POST', url: '/schedule', payload: { taskId: 't1', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T11:30:00.000Z' }, status: 201, resources: ['schedule', 'tasks'] },
  { name: 'PATCH /schedule/:id', method: 'PATCH', url: '/schedule/b1', payload: { pinned: true }, status: 200, resources: ['schedule', 'tasks'] },
  { name: 'POST /schedule/:id/start', method: 'POST', url: '/schedule/b1/start', status: 200, resources: ['schedule', 'tasks'] },
  { name: 'POST /schedule/:id/stop', method: 'POST', url: '/schedule/b1/stop', status: 200, resources: ['schedule', 'tasks'] },
  { name: 'DELETE /schedule/:id', method: 'DELETE', url: '/schedule/b1', status: 204, resources: ['schedule', 'tasks'] },
];

const rejectedCases: Array<Omit<Case, 'resources'>> = [
  { name: 'POST /habits invalid body', method: 'POST', url: '/habits', payload: { title: '' }, status: 400 },
  { name: 'PATCH /habits/:id unknown', method: 'PATCH', url: '/habits/nope', payload: { title: 'Run' }, status: 404 },
  { name: 'DELETE /habits/:id unknown', method: 'DELETE', url: '/habits/nope', status: 404 },
  { name: 'POST /categories invalid windows', method: 'POST', url: '/categories', payload: { name: 'X', windows: [{ weekday: 9, startMinute: 0, endMinute: 1 }] }, status: 400 },
  { name: 'PATCH /categories/:id unknown', method: 'PATCH', url: '/categories/nope', payload: { name: 'Home' }, status: 404 },
  { name: 'DELETE /categories/:id default', method: 'DELETE', url: '/categories/cdef', status: 409 },
  { name: 'PUT /settings invalid body', method: 'PUT', url: '/settings', payload: { timezone: 'utc' }, status: 400 },
  { name: 'POST /calendar/events invalid body', method: 'POST', url: '/calendar/events', payload: { title: 'x' }, status: 400 },
  { name: 'PATCH /calendar/events/:id inverted range', method: 'PATCH', url: '/calendar/events/e1', payload: { endsAt: '2026-01-05T09:00:00.000Z' }, status: 400 },
  { name: 'PATCH /calendar/events/:id unknown', method: 'PATCH', url: '/calendar/events/nope', payload: { title: 'x' }, status: 404 },
  { name: 'DELETE /calendar/events/:id unknown', method: 'DELETE', url: '/calendar/events/nope', status: 404 },
  { name: 'POST /schedule unknown task', method: 'POST', url: '/schedule', payload: { taskId: 'nope', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T11:30:00.000Z' }, status: 404 },
  { name: 'PATCH /schedule/:id unknown', method: 'PATCH', url: '/schedule/nope', payload: { pinned: true }, status: 404 },
  { name: 'POST /schedule/:id/start unknown', method: 'POST', url: '/schedule/nope/start', status: 404 },
  { name: 'POST /schedule/:id/start habit block', method: 'POST', url: '/schedule/hb/start', status: 400 },
  { name: 'POST /schedule/:id/stop unknown', method: 'POST', url: '/schedule/nope/stop', status: 404 },
  { name: 'POST /schedule/:id/stop habit block', method: 'POST', url: '/schedule/hb/stop', status: 400 },
  { name: 'DELETE /schedule/:id unknown', method: 'DELETE', url: '/schedule/nope', status: 404 },
];

async function send(opts: TestAppOptions, c: Omit<Case, 'resources'>) {
  const ctx = buildTestApp(opts);
  const token = await tokenFor(ctx.app);
  const res = await ctx.app.inject({
    method: c.method, url: c.url, headers: { authorization: `Bearer ${token}` },
    ...(c.payload ? { payload: c.payload } : {}),
  });
  return { ...ctx, res };
}

describe('data.changed after a successful write', () => {
  it.each(successCases)('$name emits data.changed for its resources', async (c) => {
    const { res, emitted } = await send(seed, c);
    expect(res.statusCode).toBe(c.status);
    expect(dataChanged(emitted)).toEqual([{ type: 'data.changed', userId: 'u1', resources: c.resources }]);
  });

  it.each(successCases)('$name still emits data.changed when the replan fails', async (c) => {
    const { res, emitted } = await send({ ...seed, reconcileError: new Error('google down') }, c);
    expect(res.statusCode).toBe(c.status);
    expect(dataChanged(emitted)).toEqual([{ type: 'data.changed', userId: 'u1', resources: c.resources }]);
    // The failed replan announces nothing of its own.
    await new Promise((r) => setImmediate(r));
    expect(emitted.some((e) => e.type === 'schedule.updated')).toBe(false);
  });
});

describe('no data.changed on a rejected request', () => {
  it.each(rejectedCases)('$name', async (c) => {
    const { res, emitted } = await send(seed, c);
    expect(res.statusCode).toBe(c.status);
    expect(dataChanged(emitted)).toEqual([]);
  });
});

describe('DELETE /schedule/:id', () => {
  it('still triggers no replan (it only announces the change)', async () => {
    const { res, reconcileCalls, emitted } = await send(seed, successCases.find((c) => c.name === 'DELETE /schedule/:id')!);
    expect(res.statusCode).toBe(204);
    expect(reconcileCalls).toEqual([]);
    expect(emitted.some((e) => e.type === 'schedule.updated')).toBe(false);
  });
});

describe('writes inside GET routes', () => {
  const wide = '?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z';
  const missed = blockRow({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z') });

  it('GET /schedule announces the manual-mode sweep once, and only when it discarded a row', async () => {
    const { app, emitted } = buildTestApp({ blocks: [missed], settings: settingsRow({ requireStartToTrack: true }) });
    const auth = { authorization: `Bearer ${await tokenFor(app)}` };
    expect((await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: auth })).statusCode).toBe(200);
    expect(dataChanged(emitted)).toEqual([{ type: 'data.changed', userId: 'u1', resources: ['schedule'] }]);
    // The refetch that event triggers finds nothing left to discard: no feedback loop.
    await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: auth });
    expect(dataChanged(emitted)).toHaveLength(1);
  });

  it('GET /schedule in auto mode (nothing discarded) announces nothing', async () => {
    const { app, emitted } = buildTestApp({ blocks: [missed], settings: settingsRow({ requireStartToTrack: false }) });
    await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${await tokenFor(app)}` } });
    expect(emitted).toEqual([]);
  });

  it('GET /tasks announces a purge of old completed tasks once, and only when one was purged', async () => {
    const old = taskRow({ id: 'old', status: 'completed', completedAt: new Date('2025-11-01T00:00:00.000Z') });
    const { app, emitted } = buildTestApp({ tasks: [taskRow(), old] });
    const auth = { authorization: `Bearer ${await tokenFor(app)}` };
    expect((await app.inject({ method: 'GET', url: '/tasks', headers: auth })).statusCode).toBe(200);
    // Purged tasks cascade-delete their blocks.
    expect(dataChanged(emitted)).toEqual([{ type: 'data.changed', userId: 'u1', resources: ['tasks', 'schedule'] }]);
    await app.inject({ method: 'GET', url: '/tasks', headers: auth });
    expect(dataChanged(emitted)).toHaveLength(1);
  });
});

describe('google link', () => {
  it('linking a healthy account refreshes other tabs\' google status (connected flips)', async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(dataChanged(ctx.emitted)).toEqual([{ type: 'data.changed', userId: 'u1', resources: ['googleStatus'] }]);
  });

  it('a denied callback announces nothing', async () => {
    const ctx = buildTestApp({ users: [], registrationMode: 'closed' });
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(403);
    expect(dataChanged(ctx.emitted)).toEqual([]);
  });
});

describe('data.changed delivery', () => {
  it('is forwarded only to the sockets of the event user', () => {
    const registry = createConnectionRegistry();
    const a: string[] = [];
    const b: string[] = [];
    registry.add({ userId: 'u1', send: (d) => a.push(d) });
    registry.add({ userId: 'u2', send: (d) => b.push(d) });
    const event: ServerEvent = { type: 'data.changed', userId: 'u1', resources: ['habits', 'schedule'] };
    registry.forward(event);
    expect(a.map((d) => JSON.parse(d))).toEqual([event]);
    expect(b).toEqual([]);
  });
});
