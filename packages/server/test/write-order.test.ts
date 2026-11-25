import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotFoundError } from '@notreclaim/db';
import type { CalendarEvent, ScheduledBlock, Settings } from '@notreclaim/db';
import { buildTestApp, tokenFor, type TestAppOptions } from './fakes.js';

/**
 * Characterisation tests for the block and calendar routes: they pin TODAY's order of DB
 * writes, Google calls, `data.changed` announcements and replans, and which errors are
 * swallowed vs propagated — so moving this logic out of the handlers cannot silently reorder
 * it. Some of the orders pinned here are known open defects (the Google delete runs BEFORE
 * the DB delete; Google is awaited before `data.changed`; the sweep is per row; the replan is
 * fire-and-forget). Those are fixed separately and on purpose: these tests change WITH that
 * fix, never in passing.
 */

type Ctx = ReturnType<typeof buildTestApp>;
type AnyFn = (...args: unknown[]) => Promise<unknown>;

const T = (iso: string) => new Date(iso);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'Focus',
    startsAt: T('2026-01-05T09:00:00.000Z'), endsAt: T('2026-01-05T09:30:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null,
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
function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', userId: 'u1', googleCalendarId: 'primary', googleEventId: 'g1',
    title: 'Standup', source: 'app', kind: 'event',
    startsAt: T('2026-01-05T10:00:00.000Z'), endsAt: T('2026-01-05T10:30:00.000Z'),
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}

/** Wrap repo methods so every call appends `<label>.<method> [id]` to the trace when it STARTS. */
function traceCalls(repo: object, label: string, methods: string[], trace: string[]): void {
  const r = repo as Record<string, AnyFn>;
  for (const m of methods) {
    const orig = r[m]!;
    r[m] = async (...args: unknown[]) => {
      trace.push(typeof args[1] === 'string' ? `${label}.${m} ${args[1]}` : `${label}.${m}`);
      return orig(...args);
    };
  }
}

/**
 * A test app whose repos, Google fakes and event bus all write into one ordered trace.
 * The Google fakes yield a macrotask first and record when they COMPLETE, together with what
 * the DB and the bus hold at that moment — so a Google call that is not awaited, or that runs
 * after a DB write it used to precede, shows up as a different trace.
 */
function harness(opts: TestAppOptions & { onGoogle?: (googleEventId: string) => Promise<void> } = {}) {
  const trace: string[] = [];
  let ctx: Ctx;
  let raw: { blocks: Ctx['scheduledBlocks']; events: Ctx['calendarEvents'] };
  const snapshot = async () => {
    const blocks = await raw.blocks.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    const events = await raw.events.listByUserInRange('u1', new Date(0), new Date(8.64e15));
    const announced = ctx.emitted.filter((e) => e.type === 'data.changed').length;
    return `blocks=[${blocks.map((b) => b.id).join(',')}] events=[${events.map((e) => `${e.id}:${e.title}`).join(',')}]`
      + ` announced=${announced} replans=${ctx.reconcileCalls.length}`;
  };
  const { onGoogle, ...appOpts } = opts;
  ctx = buildTestApp({
    getAccessToken: async () => { trace.push('token'); return 'access-1'; },
    insertEvent: async (_t, calendarId, ev) => {
      await tick();
      trace.push(`google.insertEvent ${calendarId} ${ev.summary} ${ev.startDateTime}..${ev.endDateTime} | ${await snapshot()}`);
      return { googleEventId: 'g-new' };
    },
    deleteEvent: async (_t, calendarId, googleEventId) => {
      await tick();
      if (onGoogle) await onGoogle(googleEventId);
      trace.push(`google.deleteEvent ${calendarId}/${googleEventId} | ${await snapshot()}`);
    },
    patchEvent: async (_t, calendarId, googleEventId, ev) => {
      await tick();
      trace.push(`google.patchEvent ${calendarId}/${googleEventId} ${ev.summary} ${ev.startDateTime}..${ev.endDateTime} | ${await snapshot()}`);
    },
    ...appOpts,
  });
  raw = { blocks: { ...ctx.scheduledBlocks }, events: { ...ctx.calendarEvents } };
  ctx.events.subscribe((e) => {
    if (e.type === 'data.changed') trace.push(`emit data.changed [${e.resources.join(',')}] | replans=${ctx.reconcileCalls.length}`);
  });
  traceCalls(ctx.scheduledBlocks, 'blocks', ['listByUserInRange', 'findById', 'create', 'update', 'delete'], trace);
  traceCalls(ctx.calendarEvents, 'events', ['create', 'findById', 'update', 'setGoogleIds', 'delete'], trace);
  const send = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) => {
    const token = await tokenFor(ctx.app);
    return ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  };
  const dataChangedCount = () => ctx.emitted.filter((e) => e.type === 'data.changed').length;
  return { ...ctx, trace, raw, send, dataChangedCount };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /schedule manual-mode sweep: order', () => {
  const wide = '?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z';
  const manual = settings({ requireStartToTrack: true });

  it('deletes each discardable row, then awaits ITS Google delete, before touching the next row; announces once after the last Google call', async () => {
    const h = harness({
      settings: manual,
      blocks: [
        block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' }),
        // Habit block: never discarded (only task blocks are).
        block({ id: 'h', taskId: null, habitId: 'hab', startsAt: T('2026-01-04T10:00:00.000Z'), endsAt: T('2026-01-04T10:30:00.000Z'), googleEventId: 'g-h', googleCalendarId: 'cal-auto' }),
        // Started: it counts as spent time, so it stays.
        block({ id: 'k', startsAt: T('2026-01-04T11:00:00.000Z'), endsAt: T('2026-01-04T11:30:00.000Z'), startedAt: T('2026-01-04T11:00:00.000Z'), googleEventId: 'g-k', googleCalendarId: 'cal-auto' }),
        // An empty taskId is falsy: kept (the rule tests taskId truthiness).
        block({ id: 'blank', taskId: '', startsAt: T('2026-01-04T12:00:00.000Z'), endsAt: T('2026-01-04T12:30:00.000Z') }),
        // Ends exactly at now: discarded (endsAt <= now).
        block({ id: 'b', startsAt: T('2026-01-04T23:30:00.000Z'), endsAt: T('2026-01-05T00:00:00.000Z'), googleEventId: 'g-b', googleCalendarId: 'cal-auto' }),
        // In progress (ends after now): kept.
        block({ id: 'p', startsAt: T('2026-01-04T23:45:00.000Z'), endsAt: T('2026-01-05T00:30:00.000Z'), googleEventId: 'g-p', googleCalendarId: 'cal-auto' }),
        block({ id: 'f', startsAt: T('2026-01-06T09:00:00.000Z'), endsAt: T('2026-01-06T09:30:00.000Z') }),
      ],
    });
    const res = await h.send('GET', `/schedule${wide}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as ScheduledBlock[]).map((b) => b.id)).toEqual(['h', 'k', 'blank', 'p', 'f']);
    expect(h.trace).toEqual([
      'blocks.listByUserInRange',
      'blocks.delete a',
      'token',
      'google.deleteEvent cal-auto/g-a | blocks=[h,k,blank,b,p,f] events=[] announced=0 replans=0',
      'blocks.delete b',
      'token',
      'google.deleteEvent cal-auto/g-b | blocks=[h,k,blank,p,f] events=[] announced=0 replans=0',
      'emit data.changed [schedule] | replans=0',
      'blocks.listByUserInRange',
    ]);
    expect(h.reconcileCalls).toEqual([]);
  });

  it('a row another request already deleted (NotFound) is skipped: no Google call for it', async () => {
    const h = harness({
      settings: manual,
      blocks: [
        block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' }),
        block({ id: 'b', startsAt: T('2026-01-04T10:00:00.000Z'), endsAt: T('2026-01-04T10:30:00.000Z'), googleEventId: 'g-b', googleCalendarId: 'cal-auto' }),
      ],
      // A concurrent sweep removes 'b' while this one is busy with a's Google call.
      onGoogle: async (googleEventId) => { if (googleEventId === 'g-a') await h.raw.blocks.delete('u1', 'b'); },
    });
    const res = await h.send('GET', `/schedule${wide}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(h.trace).toEqual([
      'blocks.listByUserInRange',
      'blocks.delete a',
      'token',
      'google.deleteEvent cal-auto/g-a | blocks=[] events=[] announced=0 replans=0',
      'blocks.delete b',
      'emit data.changed [schedule] | replans=0',
      'blocks.listByUserInRange',
    ]);
  });

  it('a NotFound row is not counted: when nothing else went, nothing is announced', async () => {
    const h = harness({
      settings: manual,
      blocks: [block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' })],
    });
    const traced = h.scheduledBlocks.delete;
    h.scheduledBlocks.delete = async (userId, id) => {
      await traced(userId, id);
      throw new NotFoundError(`ScheduledBlock ${id}`);
    };
    const res = await h.send('GET', `/schedule${wide}`);
    expect(res.statusCode).toBe(200);
    expect(h.trace).toEqual(['blocks.listByUserInRange', 'blocks.delete a', 'blocks.listByUserInRange']);
    expect(h.dataChangedCount()).toBe(0);
  });

  it('any other delete failure fails the GET (500); rows already swept stay swept and nothing is announced', async () => {
    const h = harness({
      settings: manual,
      blocks: [
        block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' }),
        block({ id: 'b', startsAt: T('2026-01-04T10:00:00.000Z'), endsAt: T('2026-01-04T10:30:00.000Z'), googleEventId: 'g-b', googleCalendarId: 'cal-auto' }),
      ],
    });
    const traced = h.scheduledBlocks.delete;
    h.scheduledBlocks.delete = async (userId, id) => {
      if (id !== 'b') return traced(userId, id);
      h.trace.push(`blocks.delete ${id}`);
      throw new Error('db down');
    };
    const res = await h.send('GET', `/schedule${wide}`);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'internal_error', message: 'Internal Server Error' });
    expect(h.trace).toEqual([
      'blocks.listByUserInRange',
      'blocks.delete a',
      'token',
      'google.deleteEvent cal-auto/g-a | blocks=[b] events=[] announced=0 replans=0',
      'blocks.delete b',
    ]);
    expect((await h.raw.blocks.listByUserInRange('u1', new Date(0), new Date(8.64e15))).map((b) => b.id)).toEqual(['b']);
    expect(h.dataChangedCount()).toBe(0);
  });
});

describe('POST /schedule/:id/start and /stop: time snapping', () => {
  it('Start on a block that ends at or before round15(now) keeps its start, but still stamps startedAt and pins', async () => {
    const h = harness({
      settings: settings(),
      blocks: [
        block({ id: 'past', startsAt: T('2026-01-04T23:00:00.000Z'), endsAt: T('2026-01-04T23:30:00.000Z') }),
        block({ id: 'edge', startsAt: T('2026-01-04T23:30:00.000Z'), endsAt: T('2026-01-05T00:00:00.000Z') }), // endsAt === round15(now)
      ],
    });
    const past = await h.send('POST', '/schedule/past/start');
    expect(past.statusCode).toBe(200);
    expect(past.json()).toMatchObject({
      startsAt: '2026-01-04T23:00:00.000Z', endsAt: '2026-01-04T23:30:00.000Z', startedAt: '2026-01-05T00:00:00.000Z', pinned: true,
    });
    const edge = await h.send('POST', '/schedule/edge/start');
    expect(edge.statusCode).toBe(200);
    expect(edge.json()).toMatchObject({
      startsAt: '2026-01-04T23:30:00.000Z', endsAt: '2026-01-05T00:00:00.000Z', startedAt: '2026-01-05T00:00:00.000Z', pinned: true,
    });
  });

  it('Start reads the clock ONCE: startedAt is that raw instant, startsAt its round15; then announces, then replans', async () => {
    // The clock moves on every read: 00:08 (→ 00:15), then 00:23 (→ 00:30), …
    const reads = [T('2026-01-05T00:08:00.000Z'), T('2026-01-05T00:23:00.000Z'), T('2026-01-05T00:41:00.000Z')].map((d) => d.getTime());
    let i = 0;
    const h = harness({
      settings: settings(),
      blocks: [block({ id: 'b1', startsAt: T('2026-01-05T00:00:00.000Z'), endsAt: T('2026-01-05T01:00:00.000Z') })],
      now: () => reads[Math.min(i++, reads.length - 1)]!,
    });
    const res = await h.send('POST', '/schedule/b1/start');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      startsAt: '2026-01-05T00:15:00.000Z', endsAt: '2026-01-05T01:00:00.000Z', startedAt: '2026-01-05T00:08:00.000Z', pinned: true,
    });
    expect(h.trace).toEqual(['blocks.findById b1', 'blocks.update b1', 'emit data.changed [schedule,tasks] | replans=0']);
    expect(h.reconcileCalls).toEqual([{ userId: 'u1', now: reads[1] }]);
  });

  it('Stop reads the clock ONCE and ends the block at its round15; then announces, then replans', async () => {
    const reads = [T('2026-01-05T00:08:00.000Z'), T('2026-01-05T00:23:00.000Z'), T('2026-01-05T00:41:00.000Z')].map((d) => d.getTime());
    let i = 0;
    const h = harness({
      settings: settings(),
      blocks: [block({ id: 'b1', startsAt: T('2026-01-04T23:00:00.000Z'), endsAt: T('2026-01-05T01:00:00.000Z'), startedAt: T('2026-01-04T23:00:00.000Z') })],
      now: () => reads[Math.min(i++, reads.length - 1)]!,
    });
    const res = await h.send('POST', '/schedule/b1/stop');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      startsAt: '2026-01-04T23:00:00.000Z', endsAt: '2026-01-05T00:15:00.000Z', startedAt: '2026-01-04T23:00:00.000Z', pinned: true,
    });
    expect(h.trace).toEqual(['blocks.findById b1', 'blocks.update b1', 'emit data.changed [schedule,tasks] | replans=0']);
    expect(h.reconcileCalls).toEqual([{ userId: 'u1', now: reads[1] }]);
  });
});

describe('DELETE /schedule/:id: order', () => {
  const mirrored = block({ id: 'b1', pinned: true, googleEventId: 'g-1', googleCalendarId: 'cal-auto' });

  it('awaits the Google delete while the row still exists, then deletes the row, then announces (no replan)', async () => {
    const h = harness({ settings: settings(), blocks: [mirrored] });
    const res = await h.send('DELETE', '/schedule/b1');
    expect(res.statusCode).toBe(204);
    expect(h.trace).toEqual([
      'blocks.findById b1',
      'token',
      'google.deleteEvent cal-auto/g-1 | blocks=[b1] events=[] announced=0 replans=0',
      'blocks.delete b1',
      'emit data.changed [schedule,tasks] | replans=0',
    ]);
    expect(h.reconcileCalls).toEqual([]);
  });

  it('an unknown id never reaches for a token: the delete itself 404s, nothing is announced', async () => {
    const h = harness({ settings: settings(), blocks: [mirrored] });
    const res = await h.send('DELETE', '/schedule/nope');
    expect(res.statusCode).toBe(404);
    expect(h.trace).toEqual(['blocks.findById nope', 'blocks.delete nope']);
    expect(h.dataChangedCount()).toBe(0);
  });

  it('a row that vanishes during the Google call: Google delete already done, then 404 and nothing announced', async () => {
    const h = harness({ settings: settings(), blocks: [mirrored] });
    const traced = h.scheduledBlocks.delete;
    h.scheduledBlocks.delete = async (userId, id) => {
      await traced(userId, id);
      throw new NotFoundError(`ScheduledBlock ${id}`);
    };
    const res = await h.send('DELETE', '/schedule/b1');
    expect(res.statusCode).toBe(404);
    expect(h.trace).toEqual([
      'blocks.findById b1',
      'token',
      'google.deleteEvent cal-auto/g-1 | blocks=[b1] events=[] announced=0 replans=0',
      'blocks.delete b1',
    ]);
    expect(h.dataChangedCount()).toBe(0);
  });
});

describe('POST /calendar/events: order', () => {
  // Non-canonical instants (no milliseconds): the Google insert gets the body's strings verbatim.
  const body = { title: 'Standup', startsAt: '2026-01-06T09:00:00Z', endsAt: '2026-01-06T09:30:00Z' };

  /** The created row is handed out as a detached copy, so only setGoogleIds' return can carry the ids. */
  function detachCreate(h: ReturnType<typeof harness>) {
    const traced = h.calendarEvents.create;
    h.calendarEvents.create = async (userId, data) => ({ ...(await traced(userId, data)) });
  }

  it('commits the row, awaits the Google insert and the id write, THEN announces and replans; the reply carries the ids', async () => {
    const h = harness();
    detachCreate(h);
    const res = await h.send('POST', '/calendar/events', body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'cal-1', googleCalendarId: 'primary', googleEventId: 'g-new', startsAt: '2026-01-06T09:00:00.000Z' });
    expect(h.trace).toEqual([
      'events.create',
      'token',
      'google.insertEvent primary Standup 2026-01-06T09:00:00Z..2026-01-06T09:30:00Z | blocks=[] events=[cal-1:Standup] announced=0 replans=0',
      'events.setGoogleIds cal-1',
      'emit data.changed [calendarEvents,schedule] | replans=0',
    ]);
    expect(h.reconcileCalls).toHaveLength(1);
  });

  it('a setGoogleIds failure after a successful insert is swallowed: 201 with null ids (the Google event is orphaned)', async () => {
    const h = harness();
    detachCreate(h);
    const traced = h.calendarEvents.setGoogleIds;
    h.calendarEvents.setGoogleIds = async (userId, id, calendarId, googleEventId) => {
      await traced(userId, id, calendarId, googleEventId);
      throw new Error('db down');
    };
    const res = await h.send('POST', '/calendar/events', body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'cal-1', googleCalendarId: null, googleEventId: null });
    expect(h.trace).toEqual([
      'events.create',
      'token',
      'google.insertEvent primary Standup 2026-01-06T09:00:00Z..2026-01-06T09:30:00Z | blocks=[] events=[cal-1:Standup] announced=0 replans=0',
      'events.setGoogleIds cal-1',
      'emit data.changed [calendarEvents,schedule] | replans=0',
    ]);
    expect(h.reconcileCalls).toHaveLength(1);
  });

  it('blocked time: create, announce, replan — no token, no Google', async () => {
    const h = harness();
    const res = await h.send('POST', '/calendar/events', { ...body, kind: 'blocked' });
    expect(res.statusCode).toBe(201);
    expect(h.trace).toEqual(['events.create', 'emit data.changed [calendarEvents,schedule] | replans=0']);
    expect(h.reconcileCalls).toHaveLength(1);
  });
});

describe('PATCH /calendar/events/:id: order', () => {
  /** findById hands out a detached snapshot, so the pre-update row and the updated row differ. */
  function detachFind(h: ReturnType<typeof harness>) {
    const traced = h.calendarEvents.findById;
    h.calendarEvents.findById = async (userId, id) => {
      const row = await traced(userId, id);
      return row ? { ...row } : row;
    };
  }

  it('commits the update, awaits the Google patch with the MERGED values, THEN announces and replans; replies with the updated row', async () => {
    const h = harness({ settings: settings(), calendarEvents: [event()] });
    detachFind(h);
    const res = await h.send('PATCH', '/calendar/events/e1', { title: 'Renamed', startsAt: '2026-01-05T09:00:00Z' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'e1', title: 'Renamed', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' });
    expect(h.trace).toEqual([
      'events.findById e1',
      'events.update e1',
      'token',
      'google.patchEvent primary/g1 Renamed 2026-01-05T09:00:00.000Z..2026-01-05T10:30:00.000Z | blocks=[] events=[e1:Renamed] announced=0 replans=0',
      'emit data.changed [calendarEvents,schedule] | replans=0',
    ]);
    expect(h.reconcileCalls).toHaveLength(1);
  });

  it('an inverted merged range replies 400 invalid_range before any write', async () => {
    const h = harness({ settings: settings(), calendarEvents: [event()] });
    const res = await h.send('PATCH', '/calendar/events/e1', { endsAt: '2026-01-05T09:00:00.000Z' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'invalid_range', message: 'endsAt must be after startsAt' });
    expect(h.trace).toEqual(['events.findById e1']);
    expect(h.reconcileCalls).toEqual([]);
  });
});

describe('DELETE /calendar/events/:id: order', () => {
  it('awaits the Google delete while the row still exists, then deletes the row, then announces and replans', async () => {
    const h = harness({ settings: settings(), calendarEvents: [event()] });
    const res = await h.send('DELETE', '/calendar/events/e1');
    expect(res.statusCode).toBe(204);
    expect(h.trace).toEqual([
      'events.findById e1',
      'token',
      'google.deleteEvent primary/g1 | blocks=[] events=[e1:Standup] announced=0 replans=0',
      'events.delete e1',
      'emit data.changed [calendarEvents,schedule] | replans=0',
    ]);
    expect(h.reconcileCalls).toHaveLength(1);
  });

  it('an unknown id 404s before anything else', async () => {
    const h = harness({ settings: settings(), calendarEvents: [event()] });
    const res = await h.send('DELETE', '/calendar/events/nope');
    expect(res.statusCode).toBe(404);
    expect(h.trace).toEqual(['events.findById nope']);
  });
});

describe('Google write-back failures are swallowed with a warn line', () => {
  const googleDown = new Error('google down');
  const failing = {
    insertEvent: async () => { throw googleDown; },
    deleteEvent: async () => { throw googleDown; },
    patchEvent: async () => { throw googleDown; },
  };

  async function sendAndCaptureWarn(h: ReturnType<typeof harness>, ...args: Parameters<ReturnType<typeof harness>['send']>) {
    await h.app.ready();
    const warn = vi.spyOn(h.app.log, 'warn');
    const res = await h.send(...args);
    return { res, calls: warn.mock.calls };
  }

  it('GET /schedule sweep', async () => {
    const h = harness({
      ...failing,
      settings: settings({ requireStartToTrack: true }),
      blocks: [block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' })],
    });
    const { res, calls } = await sendAndCaptureWarn(h, 'GET', '/schedule');
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[{ err: googleDown, blockId: 'a' }, 'google write-back failed: discarded block event not removed remotely']]);
    expect(h.dataChangedCount()).toBe(1);
  });

  it('GET /schedule sweep with no Google account (the token lookup fails)', async () => {
    const notConnected = new Error('not connected');
    const h = harness({
      getAccessToken: async () => { throw notConnected; },
      settings: settings({ requireStartToTrack: true }),
      blocks: [block({ id: 'a', startsAt: T('2026-01-04T09:00:00.000Z'), endsAt: T('2026-01-04T09:30:00.000Z'), googleEventId: 'g-a', googleCalendarId: 'cal-auto' })],
    });
    const { res, calls } = await sendAndCaptureWarn(h, 'GET', '/schedule');
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[{ err: notConnected, blockId: 'a' }, 'google write-back failed: discarded block event not removed remotely']]);
  });

  it('DELETE /schedule/:id', async () => {
    const h = harness({ ...failing, settings: settings(), blocks: [block({ id: 'b1', googleEventId: 'g-1', googleCalendarId: 'cal-auto' })] });
    const { res, calls } = await sendAndCaptureWarn(h, 'DELETE', '/schedule/b1');
    expect(res.statusCode).toBe(204);
    expect(calls).toEqual([[{ err: googleDown, blockId: 'b1' }, 'google write-back failed: block event not removed remotely']]);
  });

  it('POST /calendar/events (insert fails)', async () => {
    const h = harness({ ...failing });
    const { res, calls } = await sendAndCaptureWarn(h, 'POST', '/calendar/events', { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' });
    expect(res.statusCode).toBe(201);
    expect(calls).toEqual([[{ err: googleDown, eventId: 'cal-1' }, 'google write-back failed: event not mirrored']]);
  });

  it('POST /calendar/events (setGoogleIds fails after the insert)', async () => {
    const dbDown = new Error('db down');
    const h = harness();
    h.calendarEvents.setGoogleIds = async () => { throw dbDown; };
    const { res, calls } = await sendAndCaptureWarn(h, 'POST', '/calendar/events', { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' });
    expect(res.statusCode).toBe(201);
    expect(calls).toEqual([[{ err: dbDown, eventId: 'cal-1' }, 'google write-back failed: event not mirrored']]);
  });

  it('PATCH /calendar/events/:id', async () => {
    const h = harness({ ...failing, settings: settings(), calendarEvents: [event()] });
    const { res, calls } = await sendAndCaptureWarn(h, 'PATCH', '/calendar/events/e1', { title: 'Renamed' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[{ err: googleDown, eventId: 'e1' }, 'google write-back failed: event edit not mirrored']]);
  });

  it('DELETE /calendar/events/:id', async () => {
    const h = harness({ ...failing, settings: settings(), calendarEvents: [event()] });
    const { res, calls } = await sendAndCaptureWarn(h, 'DELETE', '/calendar/events/e1');
    expect(res.statusCode).toBe(204);
    expect(calls).toEqual([[{ err: googleDown, eventId: 'e1' }, 'google write-back failed: event not removed remotely']]);
  });
});

describe('mutation routes reply without waiting for their replan (fire-and-forget)', () => {
  const cases: Array<{ name: string; method: 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: Record<string, unknown>; status: number }> = [
    { name: 'POST /schedule', method: 'POST', url: '/schedule', payload: { taskId: 't1', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T11:30:00.000Z' }, status: 201 },
    { name: 'PATCH /schedule/:id', method: 'PATCH', url: '/schedule/b1', payload: { pinned: true }, status: 200 },
    { name: 'POST /schedule/:id/start', method: 'POST', url: '/schedule/b1/start', status: 200 },
    { name: 'POST /schedule/:id/stop', method: 'POST', url: '/schedule/b1/stop', status: 200 },
    { name: 'POST /calendar/events', method: 'POST', url: '/calendar/events', payload: { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' }, status: 201 },
    { name: 'PATCH /calendar/events/:id', method: 'PATCH', url: '/calendar/events/e1', payload: { title: 'Renamed' }, status: 200 },
    { name: 'DELETE /calendar/events/:id', method: 'DELETE', url: '/calendar/events/e1', status: 204 },
  ];

  it.each(cases)('$name', async (c) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({
      settings: settings(),
      tasks: [{
        id: 't1', userId: 'u1', title: 'T', priority: 1, sortOrder: 0, durationMs: 1800000, dueBy: null, notBefore: null,
        minChunkMs: 1800000, maxChunkMs: 1800000, categoryId: null, status: 'pending', completedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0),
      }],
      blocks: [block({ id: 'b1', startsAt: T('2026-01-04T23:00:00.000Z'), endsAt: T('2026-01-05T01:00:00.000Z') })],
      calendarEvents: [event()],
      replanGate: () => held,
    });
    const res = await h.send(c.method, c.url, c.payload);
    expect(res.statusCode).toBe(c.status);
    // The replan has been invoked but is still held, and the reply is already out.
    expect(h.reconcileCalls).toHaveLength(1);
    expect(h.emitted.some((e) => e.type === 'schedule.updated')).toBe(false);
    release();
    await vi.waitFor(() => expect(h.emitted.some((e) => e.type === 'schedule.updated')).toBe(true));
  });
});
