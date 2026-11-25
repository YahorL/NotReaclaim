import { describe, it, expect, vi } from 'vitest';
import { planLocally } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { ScheduledBlock, Settings, Task } from '@notreclaim/db';
import { makeReplan } from '../src/replan-router.js';
import { createUserLock, type WithUserLock } from '../src/user-lock.js';
import { buildTestApp, tokenFor, type TestAppOptions } from './fakes.js';

/**
 * The block routes and the replan's compute + apply share one per-user lock: an edit that
 * arrives while a replan holds it WAITS, then applies on top of the replan's result — it is
 * never overwritten, swept or pushed stale by a plan read before it. These tests hold the lock
 * by hand (standing in for a replan's compute + apply), let the "replan" write while holding
 * it, and check what the route did before and after.
 */

const T = (iso: string) => new Date(iso);
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)); };

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'Focus',
    startsAt: T('2026-01-05T09:00:00.000Z'), endsAt: T('2026-01-05T09:30:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0',
    startedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...over,
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
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Focus', priority: 1, sortOrder: 0, durationMs: 1800000, dueBy: null, notBefore: null,
  minChunkMs: 1800000, maxChunkMs: 1800000, categoryId: null, status: 'pending', completedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

/**
 * A test app whose block repo hands out DETACHED copies (like rows off the wire) and logs every
 * call, and whose lock logs every request for it. With live references a read wrongly left
 * outside the lock would still see the replan's writes and the tests would pass for the wrong
 * reason.
 */
function harness(opts: TestAppOptions = {}) {
  const calls: string[] = [];
  const lock = createUserLock();
  const withUserLock: WithUserLock = (userId, fn) => { calls.push('lock'); return lock(userId, fn); };
  const ctx = buildTestApp({ settings: settings(), tasks: [task()], ...opts, withUserLock });
  const raw = { ...ctx.scheduledBlocks };
  const repo = ctx.scheduledBlocks as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const m of ['listByUserInRange', 'findById', 'create', 'update', 'delete'] as const) {
    const orig = repo[m]!;
    repo[m] = async (...args: unknown[]) => {
      calls.push(typeof args[1] === 'string' ? `${m} ${args[1]}` : m);
      const out = await orig(...args);
      if (Array.isArray(out)) return out.map((r) => ({ ...r }));
      return out && typeof out === 'object' ? { ...out } : out;
    };
  }
  const send = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) => {
    const token = await tokenFor(ctx.app);
    return ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  };
  /** Take the user's lock like a replan's compute + apply; `release(write)` runs `write` still holding it, then lets go. */
  const holdLock = () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let write: (() => Promise<unknown>) | undefined;
    const done = lock('u1', async () => { await gate; await write?.(); });
    return {
      release: async (w?: () => Promise<unknown>) => { write = w; open(); await done; },
    };
  };
  const row = async (id: string) => raw.findById('u1', id);
  return { ...ctx, calls, raw, send, holdLock, row };
}

/** Wait until the route has asked for the lock (so it is now queued behind the holder). */
async function untilQueued(h: ReturnType<typeof harness>, locksBefore = 0) {
  await vi.waitFor(() => expect(h.calls.filter((c) => c === 'lock').length).toBeGreaterThan(locksBefore));
  await flush();
}

describe('block routes wait for a replan that holds the user lock, then apply on top of it', () => {
  it('PATCH: no write while the replan holds the lock; afterwards the drop lands over the replan move', async () => {
    const h = harness({ blocks: [block()] });
    const held = h.holdLock();
    const res = h.send('PATCH', '/schedule/b1', { startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T15:00:00.000Z', pinned: true });
    await untilQueued(h);
    expect(h.calls).not.toContain('update b1');

    // The replan moves and renames the block while it still holds the lock.
    await held.release(() => h.raw.update('u1', 'b1', { startsAt: T('2026-01-05T11:00:00.000Z'), endsAt: T('2026-01-05T11:30:00.000Z'), title: 'Renamed' }));
    const reply = await res;
    expect(reply.statusCode).toBe(200);
    expect(await h.row('b1')).toMatchObject({
      startsAt: T('2026-01-05T14:00:00.000Z'), endsAt: T('2026-01-05T15:00:00.000Z'), pinned: true, title: 'Renamed',
    });
  });

  it('POST /schedule: the pinned block is created only after the replan releases the lock', async () => {
    const h = harness();
    const held = h.holdLock();
    const res = h.send('POST', '/schedule', { taskId: 't1', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T11:30:00.000Z' });
    await untilQueued(h);
    expect(h.calls.some((c) => c.startsWith('create'))).toBe(false);
    await held.release();
    expect((await res).statusCode).toBe(201);
    expect(h.calls.filter((c) => c.startsWith('create'))).toHaveLength(1);
  });

  it('Start: clocked at ARRIVAL, computed from the row as the replan left it', async () => {
    let clock = T('2026-01-05T00:08:00.000Z').getTime(); // round15 → 00:15
    // Ends before 00:15 as stored now, so a stale read would NOT pull its start.
    const h = harness({ blocks: [block({ startsAt: T('2026-01-05T00:00:00.000Z'), endsAt: T('2026-01-05T00:10:00.000Z') })], now: () => clock });
    const held = h.holdLock();
    const res = h.send('POST', '/schedule/b1/start');
    await untilQueued(h);
    expect(h.calls).toEqual(['lock']); // not even the row read happens before the lock
    clock = T('2026-01-05T00:40:00.000Z').getTime(); // time passes while the request waits

    await held.release(() => h.raw.update('u1', 'b1', { startsAt: T('2026-01-05T09:00:00.000Z'), endsAt: T('2026-01-05T10:00:00.000Z') }));
    const reply = await res;
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      startedAt: '2026-01-05T00:08:00.000Z', startsAt: '2026-01-05T00:15:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: true,
    });
  });

  it('Stop: clocked at ARRIVAL, computed from the row as the replan left it', async () => {
    let clock = T('2026-01-05T00:08:00.000Z').getTime(); // round15 → 00:15
    const h = harness({
      blocks: [block({ pinned: true, startsAt: T('2026-01-04T23:00:00.000Z'), endsAt: T('2026-01-05T02:00:00.000Z'), startedAt: T('2026-01-04T23:00:00.000Z') })],
      now: () => clock,
    });
    const held = h.holdLock();
    const res = h.send('POST', '/schedule/b1/stop');
    await untilQueued(h);
    expect(h.calls).toEqual(['lock']);
    clock = T('2026-01-05T01:40:00.000Z').getTime();

    // Meanwhile the block was moved to 00:05–01:00 (e.g. drift pulled a Google-side edit).
    await held.release(() => h.raw.update('u1', 'b1', { startsAt: T('2026-01-05T00:05:00.000Z'), endsAt: T('2026-01-05T01:00:00.000Z') }));
    const reply = await res;
    expect(reply.statusCode).toBe(200);
    // Fresh row + arrival clock: min(01:00, max(00:15, 00:05 + 15 min)) = 00:20. A stale row
    // would give 00:15, a late clock 01:00, both 01:45.
    expect(reply.json()).toMatchObject({ startsAt: '2026-01-05T00:05:00.000Z', endsAt: '2026-01-05T00:20:00.000Z' });
  });

  it('Start on a habit block still 400s (decided under the lock, replied after it)', async () => {
    const h = harness({ blocks: [block({ taskId: null, habitId: 'h1' })] });
    const res = await h.send('POST', '/schedule/b1/start');
    expect(res.statusCode).toBe(400);
    expect(h.calls).toEqual(['lock', 'findById b1']);
    expect(h.reconcileCalls).toEqual([]);
  });

  it.each([
    ['PATCH', '/schedule/b1', { startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T15:00:00.000Z', pinned: true }],
    ['POST', '/schedule/b1/start', undefined],
    ['POST', '/schedule/b1/stop', undefined],
  ] as const)('%s %s on a row the replan removed while the request waited: 404, no write, no replan', async (method, url, payload) => {
    // e.g. the engine dropped this chunk's key and swept the block. The edit cannot land on a
    // row that is gone: it fails visibly (the optimistic UI rolls back) instead of silently.
    const h = harness({ blocks: [block()] });
    const held = h.holdLock();
    const res = h.send(method, url, payload ? { ...payload } : undefined);
    await untilQueued(h);
    await held.release(() => h.raw.delete('u1', 'b1'));
    const reply = await res;
    expect(reply.statusCode).toBe(404);
    expect(h.calls.filter((c) => c.startsWith('update') || c.startsWith('create'))).toEqual(method === 'PATCH' ? ['update b1'] : []);
    expect(h.reconcileCalls).toEqual([]);
    expect(h.emitted.filter((e) => e.type === 'data.changed')).toEqual([]);
  });

  it('DELETE: the Google delete and the row delete both wait for the lock', async () => {
    const deleted: string[] = [];
    const h = harness({
      blocks: [block({ pinned: true, googleEventId: 'g-1', googleCalendarId: 'cal-auto' })],
      accessToken: 'access-1',
      deleteEvent: async (_t, _c, id) => { deleted.push(id); },
    });
    const held = h.holdLock();
    const res = h.send('DELETE', '/schedule/b1');
    await untilQueued(h);
    expect(h.calls).toEqual(['findById b1', 'lock']); // only the peek ran
    expect(deleted).toEqual([]);
    await held.release();
    expect((await res).statusCode).toBe(204);
    expect(h.calls).toEqual(['findById b1', 'lock', 'findById b1', 'delete b1']);
    expect(deleted).toEqual(['g-1']);
    expect(await h.row('b1')).toBeNull();
  });

  it('DELETE of a row the replan removed while the request waited: 204, nothing left to do', async () => {
    let googleCalls = 0;
    const h = harness({
      blocks: [block({ googleEventId: 'g-1', googleCalendarId: 'cal-auto' })],
      accessToken: 'access-1',
      deleteEvent: async () => { googleCalls += 1; },
    });
    const held = h.holdLock();
    const res = h.send('DELETE', '/schedule/b1');
    await untilQueued(h);
    await held.release(() => h.raw.delete('u1', 'b1')); // the replan swept it (and its event)
    const reply = await res;
    expect(reply.statusCode).toBe(204);
    expect(googleCalls).toBe(0);
    expect(h.calls).toEqual(['findById b1', 'lock', 'findById b1']);
    expect(h.emitted.filter((e) => e.type === 'data.changed')).toHaveLength(1);
  });

  it('DELETE of a row that drift removes between the in-lock read and the row delete: 204', async () => {
    const h = harness({ blocks: [block({ googleEventId: 'g-1', googleCalendarId: 'cal-auto' })], accessToken: 'access-1', deleteEvent: async () => {} });
    const traced = h.scheduledBlocks.delete;
    h.scheduledBlocks.delete = async (userId, id) => { await traced(userId, id); throw new NotFoundError(`ScheduledBlock ${id}`); };
    const reply = await h.send('DELETE', '/schedule/b1');
    expect(reply.statusCode).toBe(204);
    expect(h.emitted.filter((e) => e.type === 'data.changed')).toHaveLength(1);
  });

  it('DELETE of an unknown id still 404s, without taking the lock', async () => {
    const h = harness({ blocks: [block()] });
    const reply = await h.send('DELETE', '/schedule/nope');
    expect(reply.statusCode).toBe(404);
    expect(h.calls).toEqual(['findById nope']);
  });

  it('DELETE of a row the replan mirrored while the request waited: lets go, fetches a token, retakes the lock, removes the event', async () => {
    const deleted: string[] = [];
    let tokenLookups = 0;
    const h = harness({
      blocks: [block()], // unmirrored when the request arrives: no token fetched up front
      getAccessToken: async () => { tokenLookups += 1; return 'access-1'; },
      deleteEvent: async (_t, _c, id) => { deleted.push(id); },
    });
    const held = h.holdLock();
    const res = h.send('DELETE', '/schedule/b1');
    await untilQueued(h);
    expect(tokenLookups).toBe(0);
    // First reconcile after linking Google: the replan attaches an event to the row.
    await held.release(() => h.raw.update('u1', 'b1', { googleEventId: 'g-new', googleCalendarId: 'cal-auto' }));
    expect((await res).statusCode).toBe(204);
    expect(tokenLookups).toBe(1);
    expect(deleted).toEqual(['g-new']);
    expect(h.calls).toEqual(['findById b1', 'lock', 'findById b1', 'lock', 'findById b1', 'delete b1']);
  });
});

describe('the Google token is fetched before the lock is taken', () => {
  it('a DELETE whose token lookup hangs does not hold the lock: a PATCH to another block goes through meanwhile', async () => {
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
    const h = harness({
      blocks: [block({ googleEventId: 'g-1', googleCalendarId: 'cal-auto' }), block({ id: 'b2', engineKey: 'task:t1:1' })],
      getAccessToken: async () => { await tokenGate; return 'access-1'; },
      deleteEvent: async () => {},
    });
    const del = h.send('DELETE', '/schedule/b1');
    await vi.waitFor(() => expect(h.calls).toContain('findById b1'));
    const patch = await h.send('PATCH', '/schedule/b2', { pinned: true });
    expect(patch.statusCode).toBe(200);
    releaseToken();
    expect((await del).statusCode).toBe(204);
  });

  it('a manual-mode sweep whose token lookup hangs does not hold the lock either', async () => {
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
    const h = harness({
      settings: settings({ requireStartToTrack: true }),
      blocks: [
        block({ id: 'past', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-p', googleCalendarId: 'cal-auto' }),
        block({ id: 'b2', engineKey: 'task:t1:1' }),
      ],
      getAccessToken: async () => { await tokenGate; return 'access-1'; },
      deleteEvent: async () => {},
    });
    const sweep = h.send('GET', '/schedule');
    await vi.waitFor(() => expect(h.calls).toContain('listByUserInRange'));
    await flush();
    const patch = await h.send('PATCH', '/schedule/b2', { pinned: true });
    expect(patch.statusCode).toBe(200);
    releaseToken();
    expect((await sweep).statusCode).toBe(200);
    expect(await h.row('past')).toBeNull();
  });
});

describe('GET /schedule manual-mode sweep and the lock', () => {
  const wide = '?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z';
  const manual = settings({ requireStartToTrack: true });

  it('with nothing to discard it never waits for the lock', async () => {
    const h = harness({ settings: manual, blocks: [block({ id: 'future', startsAt: T('2026-01-06T09:00:00.000Z'), endsAt: T('2026-01-06T09:30:00.000Z') })] });
    const held = h.holdLock();
    const res = await h.send('GET', `/schedule${wide}`);
    expect(res.statusCode).toBe(200);
    expect(h.calls).not.toContain('lock');
    await held.release();
  });

  it('with candidates it waits for the lock, then skips rows the replan made non-discardable', async () => {
    const h = harness({
      settings: manual,
      blocks: [
        block({ id: 'moved', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z') }),
        block({ id: 'started', engineKey: 'task:t1:1', startsAt: T('2026-01-04T10:00:00.000Z'), endsAt: T('2026-01-04T10:30:00.000Z') }),
        block({ id: 'gone', engineKey: 'task:t1:2', startsAt: T('2026-01-04T11:00:00.000Z'), endsAt: T('2026-01-04T11:30:00.000Z') }),
      ],
    });
    const held = h.holdLock();
    const res = h.send('GET', `/schedule${wide}`);
    await untilQueued(h);
    expect(h.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    await held.release(async () => {
      // The replan moved one candidate forward (its key was reissued), and the user Started another.
      await h.raw.update('u1', 'moved', { startsAt: T('2026-01-05T09:00:00.000Z'), endsAt: T('2026-01-05T09:30:00.000Z') });
      await h.raw.update('u1', 'started', { startedAt: T('2026-01-04T10:00:00.000Z') });
    });
    const reply = await res;
    expect(reply.statusCode).toBe(200);
    expect(h.calls.filter((c) => c.startsWith('delete'))).toEqual(['delete gone']);
    expect((reply.json() as ScheduledBlock[]).map((b) => b.id).sort()).toEqual(['moved', 'started']);
  });
});

describe('server wiring: a real local replan and a drag share the lock', () => {
  it('a drag sent while planLocally is between its read and its writes lands after the replan, not under it', async () => {
    const lock = createUserLock();
    let ctx!: ReturnType<typeof buildTestApp>;
    let token = '';
    let drag: Promise<{ statusCode: number }> | undefined;
    // Exactly server.ts: one lock, passed to planLocally as `exclusive` and to the app.
    const replan = makeReplan({
      reconcile: async () => { throw new Error('not connected'); },
      planLocally: (userId, now) => planLocally({
        settings: ctx.settings,
        calendarEvents: ctx.calendarEvents,
        tasks: { listByUser: async () => [task({ durationMs: 3600000, maxChunkMs: 1800000, minChunkMs: 1800000 })] },
        habits: { listByUser: async () => [] },
        scheduledBlocks: ctx.scheduledBlocks,
        categories: { listByUser: async () => [] },
      }, {
        ...ctx.scheduledBlocks,
        // apply's read (the second one): fire the drag right after it, from the outside.
        listByUserInRange: async (u, s, e) => {
          const rows = (await ctx.scheduledBlocks.listByUserInRange(u, s, e)).map((r) => ({ ...r }));
          drag ??= ctx.app.inject({
            method: 'PATCH', url: '/schedule/b1', headers: { authorization: `Bearer ${token}` },
            payload: { startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T15:00:00.000Z', pinned: true },
          });
          await flush(); // give an unlocked PATCH every chance to commit before apply writes
          return rows;
        },
      }, userId, now, (fn) => lock(userId, fn)),
      isConnected: async () => false,
    });
    ctx = buildTestApp({
      settings: settings(),
      blocks: [block({ startsAt: T('2026-01-05T09:00:00.000Z'), endsAt: T('2026-01-05T10:00:00.000Z') })],
      replan,
      withUserLock: lock,
    });
    token = await tokenFor(ctx.app);

    const res = await ctx.app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ updated: 1 });
    expect(drag).toBeDefined();
    expect((await drag!).statusCode).toBe(200);
    expect(await ctx.scheduledBlocks.findById('u1', 'b1')).toMatchObject({
      startsAt: T('2026-01-05T14:00:00.000Z'), endsAt: T('2026-01-05T15:00:00.000Z'), pinned: true,
    });
  });

  it('a route write that holds the lock delays the replan: compute + apply start only after it', async () => {
    const lock = createUserLock();
    const log: string[] = [];
    let ctx!: ReturnType<typeof buildTestApp>;
    let openUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => { openUpdate = resolve; });
    const replan = makeReplan({
      reconcile: async () => { throw new Error('not connected'); },
      planLocally: (userId, now) => {
        log.push('replan start');
        const blocks = {
          ...ctx.scheduledBlocks,
          listByUserInRange: async (u: string, s: Date, e: Date) => { log.push('replan read'); return ctx.scheduledBlocks.listByUserInRange(u, s, e); },
        };
        return planLocally({
          settings: ctx.settings,
          calendarEvents: ctx.calendarEvents,
          tasks: { listByUser: async () => [task()] },
          habits: { listByUser: async () => [] },
          scheduledBlocks: blocks,
          categories: { listByUser: async () => [] },
        }, blocks, userId, now, (fn) => lock(userId, fn));
      },
      isConnected: async () => false,
    });
    ctx = buildTestApp({ settings: settings(), blocks: [block()], replan, withUserLock: lock });
    const update = ctx.scheduledBlocks.update;
    ctx.scheduledBlocks.update = async (u, id, data) => {
      if (data.pinned) { log.push('route write'); await updateGate; log.push('route write done'); }
      return update(u, id, data);
    };
    const token = await tokenFor(ctx.app);
    const auth = { authorization: `Bearer ${token}` };

    const patch = ctx.app.inject({ method: 'PATCH', url: '/schedule/b1', headers: auth, payload: { startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T14:30:00.000Z', pinned: true } });
    await vi.waitFor(() => expect(log).toContain('route write'));
    const replanned = ctx.app.inject({ method: 'POST', url: '/schedule/replan', headers: auth });
    await vi.waitFor(() => expect(log).toContain('replan start'));
    await flush();
    expect(log).toEqual(['route write', 'replan start']); // its settings read ran; compute + apply wait

    openUpdate();
    expect((await patch).statusCode).toBe(200);
    expect((await replanned).statusCode).toBe(200);
    expect(log.slice(0, 4)).toEqual(['route write', 'replan start', 'route write done', 'replan read']);
    // The replan planned around the dropped (now pinned) block instead of moving it back.
    expect(await ctx.scheduledBlocks.findById('u1', 'b1')).toMatchObject({ startsAt: T('2026-01-05T14:00:00.000Z'), pinned: true });
  });
});
