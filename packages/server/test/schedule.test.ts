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
    meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, requireStartSince: null, dayStartMinute: 0,
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

describe('POST /schedule/:id/start ends the other running automatic pieces (you work on one thing at a time)', () => {
  const iso = (hm: string) => new Date(`2026-01-05T${hm}:00.000Z`);
  const taskRow = (id: string) => ({
    id, userId: 'u1', title: id, priority: 1, sortOrder: 0, durationMs: 7_200_000, dueBy: null, notBefore: null,
    minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending' as const, completedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  });
  async function start(opts: { now: string; blocks: ScheduledBlock[]; manual?: boolean; id?: string; times?: number }) {
    const deleted: string[] = [];
    const ctx = buildTestApp({
      blocks: opts.blocks, settings: settings({ requireStartToTrack: opts.manual ?? false, horizonDays: 7 }), now: () => iso(opts.now).getTime(),
      accessToken: 'access-1', deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
    });
    const token = await tokenFor(ctx.app);
    let res;
    for (let i = 0; i < (opts.times ?? 1); i++) {
      res = await ctx.app.inject({ method: 'POST', url: `/schedule/${opts.id ?? 'p1'}/start`, headers: { authorization: `Bearer ${token}` } });
    }
    const row = async (id: string) => ctx.scheduledBlocks.findById('u1', id);
    return { res: res!, row, deleted, ctx };
  }
  // The reviewer's probe: a 2 h task, pieces 09:00–10:00 (running, never Started) and 10:00–11:00.
  const pieces = () => [
    block({ id: 'p0', engineKey: 'task:t1:0', startsAt: iso('09:00'), endsAt: iso('10:00') }),
    block({ id: 'p1', engineKey: 'task:t1:1', startsAt: iso('10:00'), endsAt: iso('11:00') }),
  ];

  it('Start on the next piece at 09:30 ends the running one there: 90 minutes tracked for 90 minutes of work', async () => {
    const { res, row, ctx } = await start({ now: '09:30', blocks: pieces() });
    expect(res.statusCode).toBe(200);
    expect(await row('p0')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:30'), pinned: true, startedAt: null });
    expect(res.json()).toMatchObject({ id: 'p1', startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z', pinned: true });
    const repos = {
      settings: ctx.settings, calendarEvents: ctx.calendarEvents, scheduledBlocks: ctx.scheduledBlocks,
      tasks: { listByUser: async () => [taskRow('t1')] }, habits: { listByUser: async () => [] }, categories: { listByUser: async () => [] },
    };
    await planLocally(repos, ctx.scheduledBlocks, 'u1', iso('09:30').getTime());
    await planLocally(repos, ctx.scheduledBlocks, 'u1', iso('10:05').getTime());
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    // Was 120 (the frozen 09:00–10:00 kept whole next to the Started 09:30–10:30).
    expect(computeSpentMs('t1', rows, false, iso('12:00').getTime())).toBe(90 * 60_000);
  });

  it('off the quarter grid: the ended piece stops where the Started one now begins, so no minute counts twice', async () => {
    // 10-minute buffer layout: 10:10–11:10 running, 11:20–12:20 next; Start pressed at 10:19.
    // Stop alone would end 10:10 + 15 min = 10:25, over the Started block's 10:15.
    const { res, row } = await start({
      now: '10:19',
      blocks: [
        block({ id: 'p0', engineKey: 'task:t1:0', startsAt: iso('10:10'), endsAt: iso('11:10') }),
        block({ id: 'p1', engineKey: 'task:t1:1', startsAt: iso('11:20'), endsAt: iso('12:20') }),
      ],
    });
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T10:15:00.000Z', endsAt: '2026-01-05T11:15:00.000Z' });
    expect(await row('p0')).toMatchObject({ startsAt: iso('10:10'), endsAt: iso('10:15'), pinned: true });
  });

  it('a hand-placed (pinned, never Started) running block is ended too, where the Started block begins: nothing overlaps the Started block', async () => {
    const { row, ctx } = await start({
      now: '09:30',
      blocks: [
        block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('09:00'), endsAt: iso('10:00') }),
        block({ id: 'c', taskId: 'tC', pinned: true, startsAt: iso('09:10'), endsAt: iso('09:50') }), // dragged there
        block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
      ],
    });
    expect(await row('c')).toMatchObject({ startsAt: iso('09:10'), endsAt: iso('09:30'), pinned: true });
    expect(await row('a')).toMatchObject({ endsAt: iso('09:30') });
    // Nothing overlaps the Started block (09:30–10:30). (a and c overlapping 09:10–09:30 is the
    // user's own doing: c was dragged over the running a before Start.)
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    const started = rows.find((b) => b.id === 'p1')!;
    expect(started).toMatchObject({ startsAt: iso('09:30'), endsAt: iso('10:30') });
    for (const x of rows.filter((b) => b.id !== 'p1')) {
      expect(x.endsAt.getTime() <= started.startsAt.getTime() || x.startsAt.getTime() >= started.endsAt.getTime(), x.id).toBe(true);
    }
  });

  it('a hand-placed block begun 3 minutes ago is never deleted: it ends where the Started block begins', async () => {
    const { row, deleted } = await start({
      now: '09:30',
      blocks: [
        block({ id: 'c', taskId: 'tC', pinned: true, startsAt: iso('09:27'), endsAt: iso('10:27'), googleEventId: 'g-c', googleCalendarId: 'cal-auto' }),
        block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
      ],
    });
    expect(await row('c')).toMatchObject({ startsAt: iso('09:27'), endsAt: iso('09:30'), pinned: true });
    expect(deleted).toEqual([]);
  });

  it('a hand-placed block that begins where (or after) the Started block begins is left untouched', async () => {
    const { row } = await start({
      now: '09:30',
      blocks: [
        block({ id: 'c', taskId: 'tC', pinned: true, startsAt: iso('09:30'), endsAt: iso('10:30') }),
        block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
      ],
    });
    expect(await row('c')).toMatchObject({ startsAt: iso('09:30'), endsAt: iso('10:30'), pinned: true });
  });

  it('never moved back over a piece that ended a moment ago (10-minute buffer: 11:20–12:20 ended, Start at 12:21)', async () => {
    const { res, ctx } = await start({
      now: '12:21', id: 'b',
      blocks: [
        block({ id: 'a', engineKey: 'task:t1:2', startsAt: iso('11:20'), endsAt: iso('12:20') }),
        block({ id: 'b', engineKey: 'task:t1:3', startsAt: iso('12:30'), endsAt: iso('13:30') }),
      ],
    });
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T12:20:00.000Z', endsAt: '2026-01-05T13:20:00.000Z' }); // was 12:15–13:15
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    // 11:20 → 13:20 is 120 minutes of wall time; 120 minutes tracked (it was 125).
    expect(computeSpentMs('t1', rows, false, iso('14:00').getTime())).toBe(120 * 60_000);
  });

  it('a block that ends exactly now holds the start back too', async () => {
    const { res } = await start({
      now: '12:21', id: 'b',
      blocks: [
        block({ id: 'a', engineKey: 'task:t1:2', startsAt: iso('11:21'), endsAt: iso('12:21') }),
        block({ id: 'b', engineKey: 'task:t1:3', startsAt: iso('12:30'), endsAt: iso('13:30') }),
      ],
    });
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T12:21:00.000Z', endsAt: '2026-01-05T13:21:00.000Z' });
  });

  it('an off-grid end: 09:05–10:05 ended, Start at 10:06 on 10:15–11:15 → 10:05–11:05, tracked = wall time', async () => {
    const { res, ctx } = await start({
      now: '10:06', id: 'b',
      blocks: [
        block({ id: 'a', engineKey: 'task:t1:0', startsAt: iso('09:05'), endsAt: iso('10:05') }),
        block({ id: 'b', engineKey: 'task:t1:1', startsAt: iso('10:15'), endsAt: iso('11:15') }),
      ],
    });
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T10:05:00.000Z', endsAt: '2026-01-05T11:05:00.000Z' });
    const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    expect(computeSpentMs('t1', rows, false, iso('12:00').getTime())).toBe(120 * 60_000); // 09:05 → 11:05 (was 125 over 120)
  });

  it('manual tracking: only blocks that count (Started ones) hold the start back', async () => {
    const blocks = (startedAt: Date | null) => [
      block({ id: 'a', pinned: startedAt != null, startedAt, startsAt: iso('11:20'), endsAt: iso('12:20') }),
      block({ id: 'b', engineKey: 'task:t1:3', startsAt: iso('12:30'), endsAt: iso('13:30') }),
    ];
    const unstarted = await start({ now: '12:21', id: 'b', manual: true, blocks: blocks(null) });
    expect(unstarted.res.json()).toMatchObject({ startsAt: '2026-01-05T12:15:00.000Z' }); // never counted: ignored
    const started = await start({ now: '12:21', id: 'b', manual: true, blocks: blocks(iso('11:20')) });
    expect(started.res.json()).toMatchObject({ startsAt: '2026-01-05T12:20:00.000Z' });
  });

  it("another task's running piece is ended too, a pinned (Started) one is left alone", async () => {
    const { row } = await start({
      now: '09:30',
      blocks: [
        block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('09:00'), endsAt: iso('10:00') }),
        block({ id: 'started', taskId: 'tC', pinned: true, startedAt: iso('09:00'), startsAt: iso('09:00'), endsAt: iso('10:00') }),
        block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
      ],
    });
    expect(await row('a')).toMatchObject({ endsAt: iso('09:30'), pinned: true });
    expect(await row('started')).toMatchObject({ endsAt: iso('10:00') });
  });

  it('pressed twice: the second press changes nothing else', async () => {
    const { row } = await start({ now: '09:30', blocks: pieces(), times: 2 });
    expect(await row('p0')).toMatchObject({ endsAt: iso('09:30'), pinned: true });
    expect(await row('p1')).toMatchObject({ startsAt: iso('09:30'), endsAt: iso('10:30') });
  });

  it('a running piece begun less than 7.5 minutes ago is deleted with its Google event', async () => {
    const blocks = [block({ ...pieces()[0]!, startsAt: iso('09:25'), endsAt: iso('10:00'), googleEventId: 'g-p0', googleCalendarId: 'cal-auto' }), pieces()[1]!];
    const { row, deleted } = await start({ now: '09:30', blocks });
    expect(await row('p0')).toBeNull();
    expect(deleted).toEqual(['g-p0']);
  });

  it('manual tracking: Start touches no other block', async () => {
    const { row } = await start({ now: '09:30', blocks: pieces(), manual: true });
    expect(await row('p0')).toMatchObject({ endsAt: iso('10:00'), pinned: false });
  });

  it('a habit block: 400 and nothing else is touched', async () => {
    const { res, row } = await start({ now: '09:30', blocks: [...pieces(), block({ id: 'h', taskId: null, habitId: 'hab' })], id: 'h' });
    expect(res.statusCode).toBe(400);
    expect(await row('p0')).toMatchObject({ endsAt: iso('10:00'), pinned: false });
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

  // Manual tracking switched on at 2026-01-04 11:30 (requireStartSince): blocks that ended by then
  // are history kept from automatic tracking — in the database, the planner and Google — and only
  // stop counting. Never-Started blocks ending after the switch are discarded as before.
  const pastBlocks = () => {
    const past = (id: string, start: string, end: string, over: Partial<ScheduledBlock> = {}) => block({
      id, startsAt: new Date(`2026-01-04T${start}:00.000Z`), endsAt: new Date(`2026-01-04T${end}:00.000Z`),
      googleEventId: `g-${id}`, googleCalendarId: 'cal-auto', ...over,
    });
    return [
      past('auto', '09:00', '09:30'), // a frozen auto piece: tracked while the setting was off
      past('stopped', '10:00', '10:30', { pinned: true, engineKey: null }), // ended by Stop or by completing its task
      past('dragged', '11:00', '11:30', { pinned: true, engineKey: null }), // ends exactly at the switch
      past('later', '11:00', '11:31'), // ends a minute after the switch: an ordinary manual-mode block
      past('started', '12:00', '12:30', { pinned: true, startedAt: new Date('2026-01-04T12:00:00.000Z') }),
    ];
  };
  async function sweep(requireStartSince: Date | null) {
    const deleted: string[] = [];
    const { app } = buildTestApp({
      blocks: pastBlocks(), settings: settings({ requireStartToTrack: true, requireStartSince }), accessToken: 'access-1',
      deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    return { ids: (res.json() as { id: string }[]).map((b) => b.id).sort(), deleted: deleted.sort() };
  }

  it('after switching to manual, history that ended by the switch is kept (pinned or not, with its event); later un-started blocks go', async () => {
    const { ids, deleted } = await sweep(new Date('2026-01-04T11:30:00.000Z'));
    expect(ids).toEqual(['auto', 'dragged', 'started', 'stopped']);
    expect(deleted).toEqual(['g-later']);
  });

  it('manual since before the timestamp existed (null): unchanged, every past un-started block goes, pinned ones included', async () => {
    const { ids, deleted } = await sweep(null);
    expect(ids).toEqual(['started']);
    expect(deleted).toEqual(['g-auto', 'g-dragged', 'g-later', 'g-stopped']);
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
