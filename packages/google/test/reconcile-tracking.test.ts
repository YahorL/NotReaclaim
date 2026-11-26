/**
 * Automatic time tracking through the real Google path: detectDrift + compute + apply, polled
 * every 5 minutes against a calendar that remembers what was written to it. A running or
 * finished task piece must neither be moved (in the DB or on Google) nor be misread by drift.
 */
import { describe, it, expect } from 'vitest';
import type { ScheduledBlock, CreateScheduledBlockInput, UpdateScheduledBlockInput, Settings, Task, CalendarEvent } from '@notreclaim/db';
import { computeSpentMs, stopBlockEndMs, type SchedulingRepositories } from '@notreclaim/core';
import { reconcile } from '../src/reconcile.js';
import type { GoogleEvent, GoogleEventWrite, ListEventsArgs, ListEventsResult } from '../src/client.js';
import { FakeGoogleClient, fakeTokenProvider, fakeUserRepo, makeScheduledBlock, makeSettings, makeTask, makeUser } from './fakes.js';

const at = (hhmm: string, day = '2026-01-05') => Date.parse(`${day}T${hhmm}:00.000Z`); // Monday 5 Jan 2026, UTC
/** "HH:MM–HH:MM" on Monday 5 Jan, "MM-DD HH:MM–HH:MM" on any other day. */
const span = (start: string, end: string) =>
  `${start.slice(0, 10) === '2026-01-05' ? '' : `${start.slice(5, 10)} `}${start.slice(11, 16)}–${end.slice(11, 16)}`;
const H = 3_600_000;
const M = 60_000;

/** A calendar that keeps its events and lists the ones overlapping [timeMin, timeMax), like Google. */
class CalendarClient extends FakeGoogleClient {
  readonly events = new Map<string, GoogleEvent>();
  clock = 0;
  private n = 0;

  private store(id: string, e: GoogleEventWrite) {
    this.events.set(id, {
      id, status: 'confirmed', summary: e.summary,
      start: { dateTime: e.startDateTime }, end: { dateTime: e.endDateTime }, updated: new Date(this.clock).toISOString(),
    });
  }

  override async insertEvent(token: string, calendarId: string, e: GoogleEventWrite) {
    await super.insertEvent(token, calendarId, e);
    const googleEventId = `ev-${++this.n}`;
    this.store(googleEventId, e);
    return { googleEventId };
  }

  override async updateEvent(token: string, calendarId: string, id: string, e: GoogleEventWrite) {
    await super.updateEvent(token, calendarId, id, e);
    this.store(id, e);
  }

  override async deleteEvent(token: string, calendarId: string, id: string) {
    await super.deleteEvent(token, calendarId, id);
    this.events.delete(id);
  }

  override async listEvents(args: ListEventsArgs): Promise<ListEventsResult> {
    this.listCalls.push(args);
    const min = Date.parse(args.timeMin!);
    const max = Date.parse(args.timeMax!);
    return {
      events: [...this.events.values()].filter((e) => Date.parse(e.end!.dateTime!) > min && Date.parse(e.start!.dateTime!) < max),
    };
  }

  /** Every event's span (see `span`), sorted. */
  times(): string[] {
    return [...this.events.values()].map((e) => span(e.start!.dateTime!, e.end!.dateTime!)).sort();
  }
}

/** Block store honouring the range and the unique (userId, engineKey); `updatedAt` follows the clock. */
function blockStore(clock: () => number) {
  let rows: ScheduledBlock[] = [];
  let n = 0;
  const keyFree = (key: string | null | undefined, self: string | null) => {
    if (key != null && rows.some((r) => r.engineKey === key && r.id !== self)) throw new Error(`unique engineKey violated: ${key}`);
  };
  return {
    rows: () => rows,
    async listByUserInRange(_u: string, s: Date, e: Date) { return rows.filter((b) => b.startsAt < e && b.endsAt > s).map((b) => ({ ...b })); },
    async create(userId: string, data: CreateScheduledBlockInput) {
      keyFree(data.engineKey, null);
      const row = makeScheduledBlock({ id: `r${++n}`, userId, taskId: null, ...data, updatedAt: new Date(clock()) });
      rows.push(row);
      return { ...row };
    },
    async update(_u: string, id: string, data: UpdateScheduledBlockInput) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw Object.assign(new Error(`ScheduledBlock ${id} not found`), { name: 'NotFoundError' });
      if ('engineKey' in data) keyFree(data.engineKey, id);
      Object.assign(row, data, { updatedAt: new Date(clock()) });
      return { ...row };
    },
    async delete(_u: string, id: string) { rows = rows.filter((r) => r.id !== id); },
  };
}

function world(opts: { requireStartToTrack: boolean; tasks: Task[]; events?: CalendarEvent[] }) {
  const client = new CalendarClient();
  const store = blockStore(() => client.clock);
  const settings: Settings = makeSettings({
    requireStartToTrack: opts.requireStartToTrack, horizonDays: 7,
    workingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })) as never,
  });
  const schedulingRepos: SchedulingRepositories = {
    settings: { getByUserId: async () => ({ ...settings }) }, // a copy per read, like a row off the wire
    calendarEvents: { listByUserInRange: async () => opts.events ?? [] },
    tasks: { listByUser: async () => opts.tasks },
    habits: { listByUser: async () => [] },
    scheduledBlocks: { listByUserInRange: (u, s, e) => store.listByUserInRange(u, s, e) },
    categories: { listByUser: async () => [] },
  };
  const deps = {
    client, tokens: fakeTokenProvider(), scheduledBlocks: store, schedulingRepos,
    users: fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-auto' })]),
  };
  const poll = async (now: number) => {
    client.clock = now;
    const res = await reconcile(deps, 'u1', now);
    expect(res).not.toHaveProperty('createFailed');
    expect(res).not.toHaveProperty('updateFailed');
    expect(res).not.toHaveProperty('deleteFailed');
    return res;
  };
  const writes = () => ({ insert: client.insertedEvents.length, update: client.updatedEvents.length, delete: client.deletedEvents.length });
  const spentH = (now: number) => computeSpentMs('t1', store.rows(), settings.requireStartToTrack, now) / H;
  const rowTimes = () => store.rows().map((r) => span(r.startsAt.toISOString(), r.endsAt.toISOString())).sort();
  return { client, store, poll, writes, spentH, rowTimes, settings };
}

const task = (hours: number) => makeTask({ id: 't1', durationMs: hours * H, minChunkMs: 30 * M, maxChunkMs: 60 * M, dueBy: new Date('2026-01-09T17:00:00.000Z') });

async function pollDay(w: ReturnType<typeof world>) {
  await w.poll(at('08:00'));
  const first = w.writes();
  let pinnedByDrift = 0;
  for (let t = at('08:00') + 137_000; t <= at('17:30'); t += 5 * M) pinnedByDrift += (await w.poll(t)).pinned;
  const end = w.writes();
  return {
    spentH: w.spentH(at('17:30')),
    writes: { insert: end.insert - first.insert, update: end.update - first.update, delete: end.delete - first.delete },
    pinnedByDrift,
  };
}

describe('reconcile, polled every 5 minutes for a day (Google + drift)', () => {
  // Before the freeze, automatic tracking did exactly what manual tracking does: 0 h recorded,
  // 159 event updates, both pieces pushed to Tuesday.
  it('automatic tracking: the 2 h task is recorded where it ran, and the calendar keeps showing it there', async () => {
    const w = world({ requireStartToTrack: false, tasks: [task(2)] });
    const r = await pollDay(w);
    expect(r.spentH).toBe(2);
    expect(r.pinnedByDrift).toBe(0); // drift never mistook a frozen piece for a Google-side edit
    expect(w.rowTimes()).toEqual(['09:00–10:00', '10:00–11:00']);
    expect(w.client.times()).toEqual(['09:00–10:00', '10:00–11:00']);
    expect(r.writes).toEqual({ insert: 0, update: 0, delete: 0 }); // without stable keys: 1 insert + 1 delete
  });

  it('manual tracking (never pressing Start): unchanged, the pieces chase the clock', async () => {
    const w = world({ requireStartToTrack: true, tasks: [task(2)] });
    const r = await pollDay(w);
    expect(r.spentH).toBe(0);
    expect(r.writes).toEqual({ insert: 0, update: 159, delete: 0 });
    expect(w.rowTimes()).toEqual(['01-06 09:00–10:00', '01-06 10:00–11:00']);
  });

  it('a running piece with a Google event gets no update on a poll', async () => {
    const w = world({ requireStartToTrack: false, tasks: [task(1)] });
    await w.poll(at('08:00'));
    const before = w.writes();
    await w.poll(at('09:05'));
    expect(w.writes()).toEqual(before);
    expect(w.client.times()).toEqual(['09:00–10:00']);
  });
});

describe('Stop on a frozen running piece reaches Google (automatic tracking)', () => {
  /** POST /schedule/:id/stop's write, at `now`: end = stopBlockEndMs, pinned. */
  async function stop(w: ReturnType<typeof world>, now: number) {
    w.client.clock = now;
    const row = w.store.rows().find((r) => r.startsAt.getTime() <= now && r.endsAt.getTime() > now)!;
    await w.store.update('u1', row.id, { endsAt: new Date(stopBlockEndMs(row.startsAt.getTime(), row.endsAt.getTime(), now)), pinned: true });
  }

  it.each([
    ['09:37', 'rounds DOWN to 09:30, so the row has already ended', '09:00–09:30', 0.5],
    ['09:38', 'rounds UP to 09:45', '09:00–09:45', 0.75],
  ])('stopped at %s (%s): the event is shortened on the next poll, once, and the time counts', async (when, _why, shortened, spentH) => {
    const w = world({ requireStartToTrack: false, tasks: [task(1)] });
    await w.poll(at('08:00'));
    await w.poll(at('09:05'));
    await stop(w, at(when));
    const before = w.writes();
    await w.poll(at('09:40'));
    expect(w.writes().update - before.update).toBe(1);
    expect(w.client.times()).toContain(shortened);
    expect(w.client.times()).not.toContain('09:00–10:00');
    const after = w.writes();
    await w.poll(at('09:50'));
    await w.poll(at('10:30'));
    expect(w.writes().update).toBe(after.update); // pushed once
    expect(w.spentH(at('09:50'))).toBe(spentH); // the stopped piece; the re-planned rest is running
    expect(w.spentH(at('10:30'))).toBe(1); // and once the rest has run too, the full hour
    expect(w.rowTimes()).toContain(shortened); // drift never pulled the old end back
  });
});

describe('reconcile reads the tracking mode once, inside the section', () => {
  it.each([
    [true, 'switched to automatic while drift ran: the running piece stays whole, nothing is created over it', 0],
    [false, 'switched to manual while drift ran: plain manual behaviour (the un-started piece slides), no echo copy', 2],
  ] as const)('%s → %s', async (from, _label, moved) => {
    const w = world({ requireStartToTrack: from, tasks: [task(2)] });
    await w.poll(at('08:00'));
    const settings = w.settings;
    // The PUT /settings lands after the pre-lock settings read (drift's horizon) and before the section.
    const listEvents = w.client.listEvents.bind(w.client);
    w.client.listEvents = async (args) => { settings.requireStartToTrack = !from; return listEvents(args); };
    const before = w.writes();
    const res = await w.poll(at('09:30'));
    expect(res).toMatchObject({ created: 0, deleted: 0, updated: moved });
    expect(w.writes().insert).toBe(before.insert);
    expect(w.store.rows().map((r) => r.engineKey).sort()).toEqual(['task:t1:0', 'task:t1:1']);
    expect(w.rowTimes()).toEqual(from ? ['09:00–10:00', '10:00–11:00'] : ['09:30–10:30', '10:30–11:30']);
  });
});
