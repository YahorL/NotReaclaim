import { describe, it, expect, vi } from 'vitest';
import type { ScheduledBlock, Settings } from '@notreclaim/db';
import { GoogleApiError } from '@notreclaim/google';
import { computeSpentMs, planLocally } from '@notreclaim/core';
import { makeReplan } from '../src/replan-router.js';
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
    meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, dayStartMinute: 0,
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
        sortOrder: 0, notBefore: null, categoryId: null, status: 'pending', completedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0),
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
    const { app, reconcileCalls } = buildTestApp({ reconcileResult: { created: 2, updated: 1, deleted: 0, pinned: 0, removed: 0, pinnedSynced: 0, pinnedFailed: 0 } });
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

  it('DELETE /schedule/:id also removes the mirrored Google event', async () => {
    // Pinned blocks now carry googleEventIds, and nothing sweeps Google events without a
    // row — so skipping this leaves the event orphaned on the Auto-scheduled calendar.
    const deleted: Array<{ calendarId: string; googleEventId: string }> = [];
    const { app } = buildTestApp({
      blocks: [block({ pinned: true, googleEventId: 'g-1', googleCalendarId: 'cal-auto' })],
      settings: settings(),
      accessToken: 'access-1',
      deleteEvent: async (_t, calendarId, googleEventId) => { deleted.push({ calendarId, googleEventId }); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/schedule/b1', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
    expect(deleted).toEqual([{ calendarId: 'cal-auto', googleEventId: 'g-1' }]);
  });

  it('DELETE /schedule/:id still deletes the row when the Google call fails', async () => {
    const { app } = buildTestApp({
      blocks: [block({ pinned: true, googleEventId: 'g-1', googleCalendarId: 'cal-auto' })],
      settings: settings(),
      accessToken: 'access-1',
      deleteEvent: async () => { throw new Error('google down'); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/schedule/b1', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/schedule', headers: { authorization: `Bearer ${token}` } });
    expect(list.json()).toHaveLength(0);
  });

  it('DELETE /schedule/:id never reaches for a token when the block has no Google event', async () => {
    let tokenLookups = 0;
    const { app } = buildTestApp({
      blocks: [block()], settings: settings(),
      getAccessToken: async () => { tokenLookups += 1; return 'access-1'; },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/schedule/b1', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
    expect(tokenLookups).toBe(0);
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
    notBefore: null, status: 'pending', createdAt: new Date(0), updatedAt: new Date(0), subtasks: [] };
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

  it('moves an upcoming block to the snapped current time, keeping its length', async () => {
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T02:00:00.000Z'), endsAt: new Date('2026-01-05T03:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T00:00:00.000Z'); // FIXED_NOW (00:00) snapped → moved forward
    expect(res.json().endsAt).toBe('2026-01-05T01:00:00.000Z');   // the same one hour
    expect(res.json().pinned).toBe(true);
    expect(res.json().startedAt).toBe('2026-01-05T00:00:00.000Z');
  });

  it('404s an unknown block and 400s a habit block', async () => {
    const habitBlock = block({ id: 'h1', taskId: null, habitId: 'hab1' });
    const { app } = buildTestApp({ blocks: [habitBlock], settings: settings() });
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'POST', url: '/schedule/none/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/schedule/h1/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
  });
});

describe('POST /schedule/:id/stop', () => {
  it('automatic tracking: ends a frozen running piece that was never Started, pins it, and the replan keeps it and counts it', async () => {
    // The auto piece 09:00–10:00 has been running since 09:00; nobody pressed Start.
    const now = Date.parse('2026-01-05T09:37:00.000Z');
    const piece = block({ id: 'b1', startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T10:00:00.000Z') });
    const ctx = buildTestApp({ blocks: [piece], settings: settings(), now: () => now });
    const token = await tokenFor(ctx.app);
    const res = await ctx.app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    // round15(09:37) = 09:30, above the start + 15 min floor and below the planned end.
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z', pinned: true, startedAt: null });

    const task = {
      id: 't1', userId: 'u1', title: 'Focus', priority: 1, sortOrder: 0, durationMs: 3_600_000, dueBy: null, notBefore: null,
      minChunkMs: 1_800_000, maxChunkMs: 1_800_000, categoryId: null, status: 'pending' as const, completedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const repos = {
      settings: ctx.settings, calendarEvents: ctx.calendarEvents, scheduledBlocks: ctx.scheduledBlocks,
      tasks: { listByUser: async () => [task] }, habits: { listByUser: async () => [] }, categories: { listByUser: async () => [] },
    };
    await planLocally(repos, ctx.scheduledBlocks, 'u1', now);
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    expect(rows.find((r) => r.id === 'b1')).toMatchObject({ startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') });
    expect(computeSpentMs('t1', rows, false, now)).toBe(1_800_000); // the stopped half hour counts
    // …and only the other half hour is planned again, after it.
    expect(rows.filter((r) => r.id !== 'b1').map((r) => [r.startsAt.toISOString(), r.endsAt.toISOString()]))
      .toEqual([['2026-01-05T09:40:00.000Z', '2026-01-05T10:10:00.000Z']]);
  });

  it('snaps the end to the nearest 15 min of now, keeping the start', async () => {
    // block 2026-01-04T23:00 → 2026-01-05T01:00 spans FIXED_NOW (00:00); round15(00:00)=00:00
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:00:00.000Z'), endsAt: new Date('2026-01-05T01:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-04T23:00:00.000Z'); // start unchanged
    expect(res.json().endsAt).toBe('2026-01-05T00:00:00.000Z');   // end snapped to now
    expect(res.json().pinned).toBe(true);
  });

  it('floors the end to start + 15 min when now is at/before the start', async () => {
    // block starts exactly at FIXED_NOW (00:00); round15(now)=00:00 ≤ start → floor to 00:15
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T00:00:00.000Z'), endsAt: new Date('2026-01-05T02:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().endsAt).toBe('2026-01-05T00:15:00.000Z');
  });

  it('never extends the end past the original end', async () => {
    // block already ended (23:00 → 23:30, before FIXED_NOW 00:00); end must not jump to 00:00
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:00:00.000Z'), endsAt: new Date('2026-01-04T23:30:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().endsAt).toBe('2026-01-04T23:30:00.000Z'); // unchanged
  });

  it('404s an unknown block and 400s a habit block', async () => {
    const habitBlock = block({ id: 'h1', taskId: null, habitId: 'hab1' });
    const { app } = buildTestApp({ blocks: [habitBlock], settings: settings() });
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'POST', url: '/schedule/none/stop', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/schedule/h1/stop', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
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

  // Characterisation (unchanged by the automatic-tracking freeze, reported to the owner): the
  // sweep does not look at `pinned`, so the first GET after requireStartToTrack is switched ON
  // permanently deletes the whole automatically tracked history — frozen auto pieces, pieces
  // ended by Stop or by completing their task, dragged blocks — with their Google events. Only
  // Started rows survive. Switching back OFF cannot bring that time back.
  it('after switching to manual, the first GET deletes every past un-started task block, pinned ones included, with its event', async () => {
    const deleted: string[] = [];
    const past = (id: string, hh: string, over: Partial<ScheduledBlock> = {}) => block({
      id, startsAt: new Date(`2026-01-04T${hh}:00:00.000Z`), endsAt: new Date(`2026-01-04T${hh}:30:00.000Z`),
      googleEventId: `g-${id}`, googleCalendarId: 'cal-auto', ...over,
    });
    const { app } = buildTestApp({
      blocks: [
        past('auto', '09'), // a frozen auto piece: tracked time while the setting was off
        past('stopped', '10', { pinned: true, engineKey: null }), // ended by Stop or by completing its task
        past('dragged', '11', { pinned: true, engineKey: null }),
        past('started', '12', { pinned: true, startedAt: new Date('2026-01-04T12:00:00.000Z') }),
      ],
      settings: settings({ requireStartToTrack: true }), accessToken: 'access-1',
      deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect((res.json() as { id: string }[]).map((b) => b.id)).toEqual(['started']);
    expect(deleted.sort()).toEqual(['g-auto', 'g-dragged', 'g-stopped']);
  });

  it('keeps un-started past blocks in auto mode', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), startedAt: null });
    const { app } = buildTestApp({ blocks: [missed], settings: settings({ requireStartToTrack: false }) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect((res.json() as unknown[]).length).toBe(1);
  });

  it('also removes the mirrored Google event of each discarded block', async () => {
    // Nothing else ever deletes it: reconcile only deletes events of rows it still holds,
    // and detectDrift lists [now, horizon] only — a swept past row's event would be orphaned.
    const deleted: Array<{ calendarId: string; googleEventId: string }> = [];
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), googleEventId: 'g-missed', googleCalendarId: 'cal-auto' });
    const kept = block({ id: 'kept', startsAt: new Date('2026-01-04T10:00:00.000Z'), endsAt: new Date('2026-01-04T10:30:00.000Z'), startedAt: new Date('2026-01-04T10:00:00.000Z'), googleEventId: 'g-kept', googleCalendarId: 'cal-auto' });
    const { app } = buildTestApp({
      blocks: [missed, kept], settings: settings({ requireStartToTrack: true }), accessToken: 'access-1',
      deleteEvent: async (_t, calendarId, googleEventId) => { deleted.push({ calendarId, googleEventId }); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(deleted).toEqual([{ calendarId: 'cal-auto', googleEventId: 'g-missed' }]);
  });

  it('a failing Google delete never fails the GET and still discards every row', async () => {
    const a = block({ id: 'a', engineKey: 'task:t1:0', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' });
    const b = block({ id: 'b', engineKey: 'task:t1:1', startsAt: new Date('2026-01-04T10:00:00.000Z'), endsAt: new Date('2026-01-04T10:30:00.000Z'), googleEventId: 'g-b', googleCalendarId: 'cal-auto' });
    const attempted: string[] = [];
    const { app } = buildTestApp({
      blocks: [a, b], settings: settings({ requireStartToTrack: true }), accessToken: 'access-1',
      deleteEvent: async (_t, _c, googleEventId) => { attempted.push(googleEventId); throw new Error('google down'); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    expect(attempted.sort()).toEqual(['g-a', 'g-b']);
  });

  it('a concurrent GET sweeping the same rows never fails either request', async () => {
    // The planner can fire overlapping GET /schedule calls (range change + WS refetch). The
    // second one lists its candidates while the first is inside its Google round-trip, then
    // waits for the user lock the first holds, and must tolerate rows the first discarded.
    // (It is started, not awaited, from inside the Google call: awaiting it there would wait
    // for a lock the caller itself holds.)
    const a = block({ id: 'a', engineKey: 'task:t1:0', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' });
    const b = block({ id: 'b', engineKey: 'task:t1:1', startsAt: new Date('2026-01-04T10:00:00.000Z'), endsAt: new Date('2026-01-04T10:30:00.000Z'), googleEventId: 'g-b', googleCalendarId: 'cal-auto' });
    let nested: Promise<{ statusCode: number }> | null = null;
    let token = '';
    const { app } = buildTestApp({
      blocks: [a, b], settings: settings({ requireStartToTrack: true }), accessToken: 'access-1',
      deleteEvent: async () => {
        if (nested) return;
        nested = app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
        await new Promise<void>((resolve) => setImmediate(resolve)); // let it list its candidates now
      },
    });
    token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect(nested).not.toBeNull();
    expect((await nested!).statusCode).toBe(200);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  it('discards a mirrored row without failing when Google is not connected', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), googleEventId: 'g-missed', googleCalendarId: 'cal-auto' });
    let deleteCalls = 0;
    const { app } = buildTestApp({
      blocks: [missed], settings: settings({ requireStartToTrack: true }), // no accessToken: token lookup throws
      deleteEvent: async () => { deleteCalls += 1; },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    expect(deleteCalls).toBe(0);
  });

  it('never reaches for a token when the discarded block has no Google event', async () => {
    let tokenLookups = 0;
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z') });
    const { app } = buildTestApp({
      blocks: [missed], settings: settings({ requireStartToTrack: true }),
      getAccessToken: async () => { tokenLookups += 1; return 'access-1'; },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    expect(tokenLookups).toBe(0);
  });
});

describe('POST /schedule/replan realtime', () => {
  it('POST /schedule/replan emits schedule.updated with the counts so other clients refresh', async () => {
    const counts = { created: 2, updated: 1, deleted: 0, pinned: 0, removed: 0, pinnedSynced: 0, pinnedFailed: 0 };
    const { app, emitted, reconcileCalls } = buildTestApp({ reconcileResult: counts });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(counts);
    expect(emitted).toEqual([{ type: 'schedule.updated', userId: 'u1', counts }]);
    expect(reconcileCalls).toHaveLength(1); // no second, swallowed replan
  });

  it('POST /schedule/replan keeps its 502 on a Google failure and emits nothing', async () => {
    const { app, emitted } = buildTestApp({ reconcileError: new GoogleApiError(500, 'backend error') });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('google_api_error');
    expect(emitted).toEqual([]);
  });
});

describe('POST /schedule/replan with a row that fails to save', () => {
  it('still answers 200, the per-row failure count reaches the reply and schedule.updated (counts only), and the error is logged', async () => {
    let ctx!: ReturnType<typeof buildTestApp>;
    const warn = vi.fn();
    const task = (id: string) => ({
      id, userId: 'u1', title: id, priority: 1, sortOrder: 0, durationMs: 1800000, dueBy: null, notBefore: null,
      minChunkMs: 1800000, maxChunkMs: 1800000, categoryId: null, status: 'pending' as const, completedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0),
    });
    const replan = makeReplan({
      reconcile: async () => { throw new Error('not connected'); },
      planLocally: (userId, now, report) => planLocally({
        settings: ctx.settings,
        calendarEvents: ctx.calendarEvents,
        tasks: { listByUser: async () => [task('t1'), task('t2')] },
        habits: { listByUser: async () => [] },
        scheduledBlocks: ctx.scheduledBlocks,
        categories: { listByUser: async () => [] },
      }, ctx.scheduledBlocks, userId, now, undefined, report),
      isConnected: async () => false,
      warn,
    });
    ctx = buildTestApp({ settings: settings(), replan });
    // t1's task was deleted a moment ago: inserting its block hits the foreign key.
    const create = ctx.scheduledBlocks.create;
    ctx.scheduledBlocks.create = async (userId, data) => {
      if (data.taskId === 't1') throw Object.assign(new Error('Foreign key constraint violated: ScheduledBlock_taskId_fkey'), { code: 'P2003' });
      return create(userId, data);
    };
    const token = await tokenFor(ctx.app);

    const res = await ctx.app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, createFailed: 1 });
    expect(ctx.emitted).toContainEqual({ type: 'schedule.updated', userId: 'u1', counts: expect.objectContaining({ created: 1, createFailed: 1 }) });
    expect((await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15))).map((b) => b.taskId)).toEqual(['t2']);
    // Error objects stay in the log: neither the reply nor the realtime event carries them.
    expect(res.body).not.toContain('Foreign key');
    expect(JSON.stringify(ctx.emitted)).not.toContain('Foreign key');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', failed: { createFailed: 1 },
      failures: [expect.objectContaining({ kind: 'create', engineKey: 'task:t1:0', error: expect.objectContaining({ code: 'P2003' }) })],
    }), expect.any(String));
  });
});
