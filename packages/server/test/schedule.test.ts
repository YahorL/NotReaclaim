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
  /** 'HH:MM' or 'HH:MM:SS'. */
  const iso = (hm: string) => new Date(`2026-01-05T${hm.length === 5 ? `${hm}:00` : hm}.000Z`);
  const taskRow = (id: string) => ({
    id, userId: 'u1', title: id, priority: 1, sortOrder: 0, durationMs: 7_200_000, dueBy: null, notBefore: null,
    minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending' as const, completedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  });
  async function start(opts: { now: string; ms?: number; blocks: ScheduledBlock[]; manual?: boolean; id?: string; times?: number }) {
    const deleted: string[] = [];
    const ctx = buildTestApp({
      blocks: opts.blocks, settings: settings({ requireStartToTrack: opts.manual ?? false, horizonDays: 7 }), now: () => iso(opts.now).getTime() + (opts.ms ?? 0),
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

  it('residual: a hand-placed block that began at this very instant is left untouched (nothing to cut), and Start keeps round15', async () => {
    const { res, row } = await start({
      now: '09:30',
      blocks: [
        block({ id: 'c', taskId: 'tC', pinned: true, startsAt: iso('09:30'), endsAt: iso('10:30') }),
        block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
      ],
    });
    expect(await row('c')).toMatchObject({ startsAt: iso('09:30'), endsAt: iso('10:30'), pinned: true });
    expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' });
  });

  describe('Start at the exact minute: a hand-placed running block that begins at or after the snapped start is cut, not left whole', () => {
    async function trackedAfter(ctx: Awaited<ReturnType<typeof start>>['ctx'], taskIds: string[], at: string) {
      const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
      return taskIds.reduce((sum, t) => sum + computeSpentMs(t, rows, false, iso(at).getTime()), 0) / 60_000;
    }
    // The reviewer's T4f2: hand-placed H 09:15–10:15 running, Start on Y (planned 11:00) at 09:17.
    const h = (over: Partial<ScheduledBlock> = {}) =>
      block({ id: 'h', taskId: 'tH', engineKey: null, pinned: true, startsAt: iso('09:15'), endsAt: iso('10:15'), ...over });
    const y = (over: Partial<ScheduledBlock> = {}) =>
      block({ id: 'y', taskId: 'tY', engineKey: 'task:tY:0', startsAt: iso('11:00'), endsAt: iso('12:00'), ...over });

    it('T4f2, early branch: Y begins at 09:17 (keeps its hour), H ends there; tracked == wall time', async () => {
      const { res, row, ctx, deleted } = await start({ now: '09:17', id: 'y', blocks: [h(), y()] });
      expect(res.json()).toMatchObject({ id: 'y', startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:17:00.000Z', pinned: true });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:17'), pinned: true, startedAt: null });
      expect(deleted).toEqual([]);
      // 09:15 → 10:17 is 62 minutes of wall time (was 120 tracked: H whole beside Y 09:15–10:15).
      expect(await trackedAfter(ctx, ['tH', 'tY'], '12:00')).toBe(62);
    });

    it('seconds are truncated to the whole minute', async () => {
      const { res, row } = await start({ now: '09:17:40', id: 'y', blocks: [h(), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:17:00.000Z', startedAt: '2026-01-05T09:17:40.000Z' });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17') });
    });

    it('has-begun branch: Y (begun 09:16) keeps its end and begins at 09:17; H ends at 09:17', async () => {
      const { res, row, ctx } = await start({ now: '09:17', id: 'y', blocks: [h(), y({ startsAt: iso('09:16'), endsAt: iso('10:00') })] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:17'), pinned: true });
      // H 09:15–09:17 + Y 09:17–10:00 = 45 (Y's own 09:16–09:17 is dropped: Start pulls a begun start later, as before).
      expect(await trackedAfter(ctx, ['tH', 'tY'], '12:00')).toBe(45);
    });

    it('pressed within the minute H began: Y begins at the current second (milliseconds dropped: Google keeps whole seconds)', async () => {
      const { res, row } = await start({ now: '09:15:40', ms: 123, id: 'y', blocks: [h(), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:40.000Z', endsAt: '2026-01-05T10:15:40.000Z', startedAt: '2026-01-05T09:15:40.123Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:15:40') });
    });

    it('pressed within the SECOND H began (09:15:00.400): not triggered — Start keeps round15 and H is left whole (never milliseconds)', async () => {
      const { res, row } = await start({ now: '09:15', ms: 400, id: 'y', blocks: [h(), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z', startedAt: '2026-01-05T09:15:00.400Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('10:15') });
    });

    it('a begun Y that Start leaves where it is (round15 at or past its end) does not trigger it: Y keeps its start, H is left whole', async () => {
      // Y 08:00–09:10 running, H hand-placed 08:30–09:30 over it, Start on Y at 09:08 (round15 = 09:15 ≥ 09:10).
      // Cutting would move Y to 09:08 and drop its own 08:00–09:08 from the record (68 minutes).
      const { res, row } = await start({ now: '09:08', id: 'y', blocks: [h({ startsAt: iso('08:30'), endsAt: iso('09:30') }), y({ startsAt: iso('08:00'), endsAt: iso('09:10') })] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T08:00:00.000Z', endsAt: '2026-01-05T09:10:00.000Z', pinned: true });
      expect(await row('h')).toMatchObject({ startsAt: iso('08:30'), endsAt: iso('09:30') });
    });

    it('two hand-placed blocks: both end at Y\'s start', async () => {
      const { res, row, ctx } = await start({
        now: '09:17', id: 'y',
        blocks: [h(), h({ id: 'h2', taskId: 'tH2', startsAt: iso('09:16'), endsAt: iso('09:45') }), y()],
      });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z' });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17') });
      expect(await row('h2')).toMatchObject({ startsAt: iso('09:16'), endsAt: iso('09:17') });
      // Nothing overlaps Y.
      const rows = await ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
      for (const x of rows.filter((b) => b.id !== 'y')) expect(x.endsAt.getTime() <= iso('09:17').getTime(), x.id).toBe(true);
    });

    it('a hand-placed block that began before the snapped start ends at the exact start too (no gap)', async () => {
      const { row } = await start({
        now: '09:17', id: 'y',
        blocks: [h(), h({ id: 'early', taskId: 'tE', startsAt: iso('09:00'), endsAt: iso('09:45') }), y()],
      });
      expect(await row('early')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:17') });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17') });
    });

    it('with an un-pinned running piece too: it ends at Y\'s exact start (no gap); 109 tracked = every block counted once (only the user\'s own 2-minute H/a overlap twice)', async () => {
      const { row, ctx } = await start({
        now: '09:17', id: 'y',
        blocks: [h(), block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('08:30'), endsAt: iso('10:00') }), y()],
      });
      // Stop's arithmetic alone would end it at round15(09:17) = 09:15 and leave 09:15–09:17 counted nowhere.
      expect(await row('a')).toMatchObject({ startsAt: iso('08:30'), endsAt: iso('09:17'), pinned: true });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17') });
      // a 47 + H 2 (H and a overlapping 09:15–09:17 is the user's doing) + Y 60.
      expect(await trackedAfter(ctx, ['tA', 'tH', 'tY'], '12:00')).toBe(109);
    });

    it('with a short un-pinned running piece: still deleted, with its Google event', async () => {
      const { row, deleted } = await start({
        now: '09:17', id: 'y',
        blocks: [h(), block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('09:12'), endsAt: iso('10:00'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' }), y()],
      });
      expect(await row('a')).toBeNull();
      expect(deleted).toEqual(['g-a']);
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17') });
    });

    it('with the recent-end clamp: the clamped start (09:16) is the one H is judged against; H began there, so Y begins at 09:17', async () => {
      // An auto piece ended at 09:16 (off the grid), H hand-placed from 09:16; Start Y at 09:17.
      const { res, row, ctx } = await start({
        now: '09:17', id: 'y',
        blocks: [h({ startsAt: iso('09:16'), endsAt: iso('10:16') }), block({ id: 'done', taskId: 'tD', engineKey: 'task:tD:0', startsAt: iso('08:00'), endsAt: iso('09:16') }), y()],
      });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:17:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:16'), endsAt: iso('09:17') });
      expect(await row('done')).toMatchObject({ endsAt: iso('09:16') });
      // 08:00 → 10:17 is 137 minutes of wall time (was 196: H whole beside Y 09:16–10:16).
      expect(await trackedAfter(ctx, ['tD', 'tH', 'tY'], '12:00')).toBe(137);
    });

    it('the clamp alone already past H (an end at 09:17:20, Start at 09:17:40): unchanged, Y from 09:17:20 and H ends there', async () => {
      const { res, row } = await start({
        now: '09:17:40', id: 'y',
        blocks: [h(), block({ id: 'done', taskId: 'tD', engineKey: 'task:tD:0', startsAt: iso('08:00'), endsAt: iso('09:17:20') }), y()],
      });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:20.000Z', endsAt: '2026-01-05T10:17:20.000Z' });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:17:20') });
    });

    it('a never-Started block pinned by Stop whose floor end is still ahead is cut the same way', async () => {
      // Auto 09:15–10:15 stopped at 09:16 → 09:15–09:30 (pinned, never Started); Start Y at 09:17.
      const { res, row, ctx } = await start({ now: '09:17', id: 'y', blocks: [h({ endsAt: iso('09:30'), engineKey: 'task:tH:0' }), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:17') });
      expect(await trackedAfter(ctx, ['tH', 'tY'], '12:00')).toBe(62); // was 75 (09:15–09:30 twice)
    });

    it('pressed twice: the second press changes nothing (H\'s new end holds Y at 09:17)', async () => {
      const { res, row } = await start({ now: '09:17:40', id: 'y', blocks: [h(), y()], times: 2 });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:17:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:17') });
    });

    it('on the grid with no such block: unchanged, round15', async () => {
      // H began before the snapped start (09:15): it ends there, Y begins at 09:15.
      const { res, row } = await start({ now: '09:17', id: 'y', blocks: [h({ startsAt: iso('09:00') }), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z' });
      expect(await row('h')).toMatchObject({ endsAt: iso('09:15') });
    });

    it('fallback: a begun Y that has already ended at the exact minute keeps today\'s round15 patch, and H is left whole', async () => {
      // Y 08:00–09:16, Start at 09:17 (outside the web: it has ended) → round15 makes it 09:15–09:16.
      const { res, row } = await start({ now: '09:17', id: 'y', blocks: [h(), y({ startsAt: iso('08:00'), endsAt: iso('09:16') })] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T09:16:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('10:15') });
    });

    it('only hand-placed blocks trigger it: an auto piece begun after the snapped start is deleted (short) and Start keeps round15', async () => {
      const { res, row } = await start({
        now: '09:17', id: 'y',
        blocks: [block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('09:16'), endsAt: iso('10:00') }), y()],
      });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z' });
      expect(await row('a')).toBeNull();
    });

    it('manual tracking: unchanged, round15 and H untouched', async () => {
      const { res, row } = await start({ now: '09:17', id: 'y', manual: true, blocks: [h(), y()] });
      expect(res.json()).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z' });
      expect(await row('h')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('10:15') });
    });
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

  const startedTwoTasks = () => [
    block({ id: 'a', taskId: 'tA', engineKey: 'task:tA:0', startsAt: iso('09:00'), endsAt: iso('10:00') }),
    block({ id: 'started', taskId: 'tC', pinned: true, startedAt: iso('09:00'), startsAt: iso('09:00'), endsAt: iso('10:00') }),
    block({ id: 'p1', taskId: 'tB', engineKey: 'task:tB:0', startsAt: iso('11:00'), endsAt: iso('12:00') }),
  ];

  it("another task's running piece is ended too, and so is a running Started one (it keeps its startedAt)", async () => {
    const { row } = await start({ now: '09:30', blocks: startedTwoTasks() });
    expect(await row('a')).toMatchObject({ endsAt: iso('09:30'), pinned: true });
    // Was left alone (endsAt 10:00): both counted 09:30–10:00.
    expect(await row('started')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:30'), pinned: true, startedAt: iso('09:00') });
  });

  it('manual tracking: a running Started block is left alone too (Start writes only the started block)', async () => {
    const { res, row } = await start({ now: '09:30', blocks: startedTwoTasks(), manual: true });
    expect(res.json()).toMatchObject({ id: 'p1', startsAt: '2026-01-05T09:30:00.000Z' });
    expect(await row('started')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('10:00'), startedAt: iso('09:00') });
    expect(await row('a')).toMatchObject({ endsAt: iso('10:00'), pinned: false });
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

  describe('automatic tracking: Start ends a running block that was Started too ("Start next")', () => {
    /** An app whose clock the test moves, for a sequence of presses. */
    async function session(blocks: ScheduledBlock[], opts: { manual?: boolean } = {}) {
      let clock = 0;
      const deleted: string[] = [];
      const ctx = buildTestApp({
        blocks, settings: settings({ requireStartToTrack: opts.manual ?? false, horizonDays: 7 }), now: () => clock,
        accessToken: 'access-1', deleteEvent: async (_t, _c, googleEventId) => { deleted.push(googleEventId); },
      });
      const token = await tokenFor(ctx.app);
      const press = async (verb: 'start' | 'stop', id: string, at: string) => {
        clock = iso(at).getTime();
        const res = await ctx.app.inject({ method: 'POST', url: `/schedule/${id}/${verb}`, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode, `${verb} ${id} at ${at}`).toBe(200);
        return res.json();
      };
      const row = (id: string) => ctx.scheduledBlocks.findById('u1', id);
      const rows = () => ctx.scheduledBlocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
      const tracked = async (taskIds: string[], at: string) => {
        const all = await rows();
        return taskIds.reduce((sum, t) => sum + computeSpentMs(t, all, false, iso(at).getTime()), 0) / 60_000;
      };
      return { press, row, rows, tracked, deleted, ctx };
    }
    const planned = (id: string, taskId: string, from: string, to: string) =>
      block({ id, taskId, engineKey: `task:${taskId}:0`, startsAt: iso(from), endsAt: iso(to) });
    const started = (id: string, taskId: string, from: string, to: string, startedAt = from, over: Partial<ScheduledBlock> = {}) =>
      block({ id, taskId, engineKey: null, pinned: true, startedAt: iso(startedAt), startsAt: iso(from), endsAt: iso(to), ...over });

    it("the reviewer's scenario: X Started and running, Start on Y at 09:30 → X ends at 09:30, Y runs; tracked == wall time", async () => {
      const s = await session([started('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00')]);
      expect(await s.press('start', 'y', '09:30')).toMatchObject({ startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' });
      expect(await s.row('x')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:30'), pinned: true, startedAt: iso('09:00') });
      expect(await s.tracked(['tX', 'tY'], '12:00')).toBe(90); // 09:00 → 10:30; was 120
    });

    it('X Started 30 minutes ago, then quick Y (09:30), then quick Z (09:34): X ended at the hand-over and kept, Y removed, Z running', async () => {
      const s = await session([started('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00'), planned('z', 'tZ', '13:00', '14:00')]);
      await s.press('start', 'y', '09:30'); // X ran 30 minutes: it ends at 09:30, Y from 09:30
      // Y began 4 minutes ago: removed (it was "ended at 09:34, kept" before the owner's decision; Z was from 09:34).
      expect(await s.press('start', 'z', '09:34')).toMatchObject({ startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' });
      expect(await s.row('x')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:30'), startedAt: iso('09:00') });
      expect(await s.row('y')).toBeNull();
      expect(await s.tracked(['tX', 'tY', 'tZ'], '12:00')).toBe(90); // 09:00 → 10:30, nothing twice
    });

    it('a quick chain X (09:00) → Y (09:02) → Z (09:04): only Z remains, nothing counted twice', async () => {
      const s = await session([planned('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00'), planned('z', 'tZ', '13:00', '14:00')]);
      await s.press('start', 'x', '09:00');
      await s.press('start', 'y', '09:02');
      expect(await s.press('start', 'z', '09:04')).toMatchObject({ startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' });
      expect((await s.rows()).map((r) => r.id)).toEqual(['z']);
      expect(await s.tracked(['tX', 'tY', 'tZ'], '12:00')).toBe(60);
    });

    it('owner decision "Remove X\'s block": a Started block whose snapped start is still ahead is removed, with its Google event (once)', async () => {
      // Start on X at 09:38 → 09:45–10:45 (rounded up); "Start next" on Y at 09:40 → Y 09:45–10:45 and X removed.
      const s = await session([planned('x', 'tX', '11:00', '12:00'), planned('y', 'tY', '13:00', '14:00')]);
      await s.press('start', 'x', '09:38');
      await s.ctx.scheduledBlocks.update('u1', 'x', { googleEventId: 'g-x', googleCalendarId: 'cal-auto' }); // mirrored meanwhile
      expect(await s.press('start', 'y', '09:40')).toMatchObject({ startsAt: '2026-01-05T09:45:00.000Z', endsAt: '2026-01-05T10:45:00.000Z' });
      expect(await s.row('x')).toBeNull();
      expect(s.deleted).toEqual(['g-x']);
      expect(await s.tracked(['tX', 'tY'], '12:00')).toBe(60); // was 120 (60 minutes twice); X's 2 minutes are not counted
    });

    it('the Stop variant: X Started 09:08 (→ 09:15), stopped 09:10 (→ 09:15–09:30), Start Y at 09:11 → X removed', async () => {
      const s = await session([planned('x', 'tX', '11:00', '12:00'), planned('y', 'tY', '13:00', '14:00')]);
      await s.press('start', 'x', '09:08');
      expect(await s.press('stop', 'x', '09:10')).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T09:30:00.000Z' });
      expect(await s.press('start', 'y', '09:11')).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z' });
      expect(await s.row('x')).toBeNull();
      expect(await s.tracked(['tX', 'tY'], '12:00')).toBe(60); // was 75 (09:15–09:30 twice)
    });

    it('the reached-start sliver: X Started 09:44 (→ 09:45), Start Y at 09:47 → X removed, and it neither forces the exact minute nor clamps Y', async () => {
      const s = await session([planned('x', 'tX', '11:00', '12:00'), planned('y', 'tY', '13:00', '14:00')]);
      await s.press('start', 'x', '09:44');
      // Was: Y from 09:47 (exact minute) and X 09:45–09:47. Now Y keeps round15(09:47) = 09:45.
      expect(await s.press('start', 'y', '09:47')).toMatchObject({ startsAt: '2026-01-05T09:45:00.000Z', endsAt: '2026-01-05T10:45:00.000Z' });
      expect(await s.row('x')).toBeNull();
    });

    it('boundary: begun exactly 7.5 minutes ago is kept (ended at the hand-over); 7 min 29 s ago is removed', async () => {
      const kept = await session([started('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00')]);
      expect(await kept.press('start', 'y', '09:07:30')).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z' }); // round15 rounds half up
      expect(await kept.row('x')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('09:15'), startedAt: iso('09:00') });
      expect(await kept.tracked(['tX', 'tY'], '12:00')).toBe(75); // 09:00 → 10:15
      const removed = await session([started('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00')]);
      expect(await removed.press('start', 'y', '09:07:29')).toMatchObject({ startsAt: '2026-01-05T09:00:00.000Z' });
      expect(await removed.row('x')).toBeNull();
    });

    it('whatever its origin: an unpinned (PATCH) or hand-placed-then-Started block begun under 7.5 minutes ago is removed', async () => {
      const unpinned = await session([started('x', 'tX', '09:25', '10:25', '09:25', { pinned: false }), planned('y', 'tY', '11:00', '12:00')]);
      await unpinned.press('start', 'y', '09:30');
      expect(await unpinned.row('x')).toBeNull();
      const handPlaced = await session([block({ id: 'x', taskId: 'tX', engineKey: null, pinned: true, startsAt: iso('09:25'), endsAt: iso('10:25') }), planned('y', 'tY', '11:00', '12:00')]);
      await handPlaced.press('start', 'x', '09:26');
      await handPlaced.press('start', 'y', '09:30');
      expect(await handPlaced.row('x')).toBeNull();
    });

    it('Stop on a Started block (15-minute floor ahead) then Start another 3 minutes after Start: the stopped block is removed', async () => {
      const s = await session([planned('x', 'tX', '10:00', '11:00'), planned('y', 'tY', '12:00', '13:00')]);
      await s.press('start', 'x', '10:00');
      expect(await s.press('stop', 'x', '10:02')).toMatchObject({ endsAt: '2026-01-05T10:15:00.000Z' });
      // Was: Y from 10:03 (exact minute), X 10:00–10:03 kept (63 tracked). X began 3 minutes ago: removed, Y keeps round15.
      expect(await s.press('start', 'y', '10:03')).toMatchObject({ startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z' });
      expect(await s.row('x')).toBeNull();
      expect(await s.tracked(['tX', 'tY'], '12:00')).toBe(60);
    });

    it('Stop on a Started block begun 8 minutes ago (floor end ahead), then Start another: its end is pulled back to the exact minute', async () => {
      const s = await session([planned('x', 'tX', '11:00', '12:00'), planned('y', 'tY', '13:00', '14:00')]);
      await s.press('start', 'x', '09:08'); // → 09:15–10:15
      expect(await s.press('stop', 'x', '09:16')).toMatchObject({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T09:30:00.000Z' });
      expect(await s.press('start', 'y', '09:17')).toMatchObject({ startsAt: '2026-01-05T09:17:00.000Z', endsAt: '2026-01-05T10:17:00.000Z' });
      expect(await s.row('x')).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:17'), startedAt: iso('09:08') });
      expect(await s.tracked(['tX', 'tY'], '12:00')).toBe(62); // 09:15 → 10:17; X's 09:08–09:15 was never on the record (Start snapped it)
    });

    it('a Started block is ended at the new start when the recent-end clamp raises it above round15 (not at round15, which would drop minutes)', async () => {
      // Another block ended at 09:36; Start Y at 09:37 → Y from 09:36 (the clamp). Stop's arithmetic alone would end X at 09:30.
      const s = await session([started('x', 'tX', '09:00', '10:00'), planned('done', 'tD', '09:20', '09:36'), planned('y', 'tY', '11:00', '12:00')]);
      expect(await s.press('start', 'y', '09:37')).toMatchObject({ startsAt: '2026-01-05T09:36:00.000Z' });
      expect(await s.row('x')).toMatchObject({ endsAt: iso('09:36') });
    });

    it('a Started block kept (begun 7.5 minutes ago or more) still triggers the exact minute, pinned or not', async () => {
      for (const pinned of [true, false]) {
        // Started at 09:08 → runs from 09:15; at 09:16 it began 8 minutes ago (beganAt = 09:08): kept.
        const s = await session([started('x', 'tX', '09:15', '10:15', '09:08', { pinned }), planned('y', 'tY', '11:00', '12:00')]);
        expect(await s.press('start', 'y', '09:16')).toMatchObject({ startsAt: '2026-01-05T09:16:00.000Z' });
        expect(await s.row('x'), `pinned ${pinned}`).toMatchObject({ startsAt: iso('09:15'), endsAt: iso('09:16'), startedAt: iso('09:08') });
      }
    });

    it('a hand-placed block that was never Started is still never deleted (it ends at the new start)', async () => {
      const s = await session([block({ id: 'h', taskId: 'tH', engineKey: null, pinned: true, startsAt: iso('09:27'), endsAt: iso('10:27') }), planned('y', 'tY', '11:00', '12:00')]);
      await s.press('start', 'y', '09:30');
      expect(await s.row('h')).toMatchObject({ startsAt: iso('09:27'), endsAt: iso('09:30'), startedAt: null });
    });

    it("after the removal the removed block's task is planned again (no Started block left)", async () => {
      const s = await session([planned('x', 'tX', '11:00', '12:00'), planned('y', 'tY', '13:00', '14:00')]);
      await s.press('start', 'x', '09:38');
      await s.press('start', 'y', '09:40');
      const repos = {
        settings: s.ctx.settings, calendarEvents: s.ctx.calendarEvents, scheduledBlocks: s.ctx.scheduledBlocks,
        tasks: { listByUser: async () => [taskRow('tX'), taskRow('tY')] }, habits: { listByUser: async () => [] }, categories: { listByUser: async () => [] },
      };
      await planLocally(repos, s.ctx.scheduledBlocks, 'u1', iso('09:40').getTime());
      const replanned = (await s.rows()).filter((r) => r.taskId === 'tX');
      expect(replanned.length).toBeGreaterThan(0);
      expect(replanned.every((r) => !r.pinned && r.startedAt == null && r.engineKey != null)).toBe(true);
    });

    it('Start on the running Started block itself: never ends itself; the same instant changes nothing; later it touches no other block', async () => {
      const s = await session([started('x', 'tX', '09:30', '10:30'), planned('done', 'tD', '08:00', '09:00')]);
      expect(await s.press('start', 'x', '09:30')).toMatchObject({ startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z', startedAt: '2026-01-05T09:30:00.000Z' });
      // A later press pulls the start to round15(now) (the existing re-Start behaviour, §10) and keeps the end.
      expect(await s.press('start', 'x', '09:40')).toMatchObject({ startsAt: '2026-01-05T09:45:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' });
      expect(await s.row('done')).toMatchObject({ startsAt: iso('08:00'), endsAt: iso('09:00'), pinned: false });
      expect(await s.rows()).toHaveLength(2);
    });

    it('manual tracking: unchanged, a Started running block is left alone ("Start next" is not offered there)', async () => {
      const s = await session([started('x', 'tX', '09:00', '10:00'), planned('y', 'tY', '11:00', '12:00')], { manual: true });
      await s.press('start', 'y', '09:30');
      expect(await s.row('x')).toMatchObject({ startsAt: iso('09:00'), endsAt: iso('10:00') });
    });
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
