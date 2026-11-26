/**
 * Automatic time tracking (`requireStartToTrack = false`): a task piece whose start has passed
 * is the user's record of work, so a replan must neither slide a RUNNING piece forward (B1) nor
 * move a FINISHED one into the future by reusing its engine key (B2). Manual tracking is
 * unchanged: un-started pieces keep sliding until they are Started.
 *
 * The harness replans exactly like planLocally (compute + apply), optionally through a counting
 * mirror standing in for Google, over a block store that enforces the real unique
 * (userId, engineKey) key — loudly, so a fix that collides fails the test instead of being
 * isolated as a row failure.
 */
import { describe, it, expect } from 'vitest';
import type {
  ScheduledBlock as DbScheduledBlock, CreateScheduledBlockInput, UpdateScheduledBlockInput, Settings, Task, CalendarEvent,
} from '@notreclaim/db';
import { computeDesiredSchedule } from '../src/compute.js';
import { applyDesiredSchedule, type ApplyCounts, type ScheduleMirror } from '../src/apply.js';
import { horizonEndMs } from '../src/time-windows.js';
import { computeSpentMs, isFrozenTaskRow } from '../src/spent.js';
import { fakeRepos, makeSettings, makeTask, makeEvent, makeBlock } from './fakes.js';

const at = (hhmm: string, day = '2026-01-05') => Date.parse(`${day}T${hhmm}:00.000Z`); // Monday 5 Jan 2026, UTC
const H = 3_600_000;
const M = 60_000;

function weekdaySettings(over: Partial<Settings> = {}): Settings {
  return makeSettings({
    workingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })) as never,
    horizonDays: 7,
    ...over,
  });
}
const task = (hours: number, over: Partial<Task> = {}) =>
  makeTask({ durationMs: hours * H, minChunkMs: 30 * M, maxChunkMs: 60 * M, ...over });
const ev = (id: string, a: string, b: string) => makeEvent({ id, startsAt: new Date(at(a)), endsAt: new Date(at(b)) });

function blockStore() {
  let rows: DbScheduledBlock[] = [];
  let n = 0;
  const assertKeyFree = (key: string | null | undefined, selfId: string | null) => {
    if (key != null && rows.some((r) => r.engineKey === key && r.id !== selfId)) {
      throw new Error(`unique (userId, engineKey) violated: ${key}`);
    }
  };
  return {
    rows: () => rows,
    listByUserInRange: async (_u: string, s: Date, e: Date) => rows.filter((b) => b.startsAt < e && b.endsAt > s),
    create: async (userId: string, data: CreateScheduledBlockInput) => {
      assertKeyFree(data.engineKey, null);
      const row = makeBlock({ id: `r${++n}`, userId, taskId: null, ...data });
      rows.push(row);
      return row;
    },
    update: async (_u: string, id: string, data: UpdateScheduledBlockInput) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw Object.assign(new Error(`ScheduledBlock ${id} not found`), { name: 'NotFoundError' });
      if ('engineKey' in data) assertKeyFree(data.engineKey, id);
      Object.assign(row, data);
      return row;
    },
    delete: async (_u: string, id: string) => { rows = rows.filter((r) => r.id !== id); },
  };
}

/** A Google stand-in that counts writes; every created block gets an event id. */
function countingMirror() {
  const calls = { create: 0, update: 0, delete: 0 };
  let ev = 0;
  const mirror: ScheduleMirror = {
    create: async () => { calls.create++; return { googleEventId: `g${++ev}`, googleCalendarId: 'auto' }; },
    update: async () => { calls.update++; return undefined; },
    delete: async () => { calls.delete++; },
  };
  return { calls, mirror };
}

interface World {
  settings: Settings;
  tasks: Task[];
  events?: CalendarEvent[];
  store: ReturnType<typeof blockStore>;
}

function world(over: Partial<World> & { tasks: Task[] }): World {
  return { settings: weekdaySettings(), store: blockStore(), ...over };
}

async function replan(w: World, now: number, mirror?: ScheduleMirror): Promise<ApplyCounts> {
  const repos = {
    ...fakeRepos({ settings: w.settings, tasks: w.tasks, events: w.events ?? [] }),
    scheduledBlocks: { listByUserInRange: w.store.listByUserInRange },
  };
  const desired = await computeDesiredSchedule(repos, 'u1', now);
  const counts = await applyDesiredSchedule(w.store, 'u1', desired, {
    now, horizonEnd: horizonEndMs(now, w.settings.horizonDays), mirror, requireStartToTrack: w.settings.requireStartToTrack,
  });
  expect(counts).not.toHaveProperty('createFailed');
  expect(counts).not.toHaveProperty('updateFailed');
  expect(counts).not.toHaveProperty('deleteFailed');
  return counts;
}

const spent = (w: World, now: number, taskId = 't1') => computeSpentMs(taskId, w.store.rows(), w.settings.requireStartToTrack, now);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** Each row as "HH:MM–HH:MM" (Monday) or "Tue HH:MM–HH:MM", sorted by start. */
const times = (w: World, taskId = 't1') => w.store.rows()
  .filter((r) => r.taskId === taskId)
  .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  .map((r) => {
    const day = r.startsAt.toISOString().slice(0, 10) === '2026-01-05' ? '' : `${r.startsAt.toISOString().slice(5, 10)} `;
    return `${day}${hhmm(r.startsAt.getTime())}–${hhmm(r.endsAt.getTime())}`;
  });
const keys = (w: World, taskId = 't1') => w.store.rows()
  .filter((r) => r.taskId === taskId)
  .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  .map((r) => r.engineKey);
const noWrites = { created: 0, updated: 0, deleted: 0 };

describe('isFrozenTaskRow', () => {
  const row = (over: Partial<DbScheduledBlock> = {}) =>
    makeBlock({ taskId: 't1', pinned: false, startsAt: new Date(at('09:00')), endsAt: new Date(at('10:00')), ...over });
  const cases: Array<[string, Partial<DbScheduledBlock>, number, boolean, boolean]> = [
    // label, row, now, requireStartToTrack, frozen
    ['auto, before its start', {}, at('08:59'), false, false],
    ['auto, exactly at its start', {}, at('09:00'), false, true],
    ['auto, running', {}, at('09:30'), false, true],
    ['auto, exactly at its end', {}, at('10:00'), false, true],
    ['auto, finished', {}, at('12:00'), false, true],
    ['auto, pinned (the pinned path owns it)', { pinned: true }, at('09:30'), false, false],
    ['auto, a habit row (R21 owns it)', { taskId: null, habitId: 'h1' }, at('09:30'), false, false],
    ['manual, running', {}, at('09:30'), true, false],
    ['manual, finished', {}, at('12:00'), true, false],
  ];
  it.each(cases)('%s', (_label, over, now, requireStartToTrack, frozen) => {
    expect(isFrozenTaskRow(row(over), now, requireStartToTrack)).toBe(frozen);
  });
});

describe('B2 — a finished piece keeps its time (automatic tracking)', () => {
  it('2 h task around a meeting: after 09–10 ends, the replan keeps it and plans only the remaining hour', async () => {
    const w = world({ tasks: [task(2)], events: [ev('m', '10:00', '11:00')] });
    await replan(w, at('08:00'));
    expect(times(w)).toEqual(['09:00–10:00', '11:00–12:00']);
    expect(await replan(w, at('10:30'))).toMatchObject(noWrites); // stable keys: the remainder is still task:t1:1
    expect(times(w)).toEqual(['09:00–10:00', '11:00–12:00']);
    expect(keys(w)).toEqual(['task:t1:0', 'task:t1:1']);
    expect(spent(w, at('10:30'))).toBe(1 * H);
    expect(await replan(w, at('10:35'))).toMatchObject(noWrites);
    expect(spent(w, at('12:00'))).toBe(2 * H);
  });

  it('3 h task: two finished pieces and a running one all stay where they were', async () => {
    const w = world({ tasks: [task(3)] });
    await replan(w, at('08:00'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00', '11:00–12:00']);
    await replan(w, at('11:30'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00', '11:00–12:00']);
    expect(spent(w, at('11:30'))).toBe(2 * H);
    expect(spent(w, at('12:00'))).toBe(3 * H);
  });

  it('a task with nothing left (remainder 0) is untouched', async () => {
    const w = world({ tasks: [task(1)] });
    await replan(w, at('08:00'));
    expect(await replan(w, at('10:30'))).toMatchObject(noWrites);
    expect(times(w)).toEqual(['09:00–10:00']);
  });

  it('a local user editing 4 times a day records the full 3 h', async () => {
    const w = world({ tasks: [task(3)] });
    await replan(w, at('08:00'));
    for (const t of ['09:30', '10:20', '11:45', '15:10']) await replan(w, at(t));
    expect(spent(w, at('17:30'))).toBe(3 * H);
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00', '11:00–12:00']);
  });

  it('manual mode is unchanged: an un-started finished piece is recycled forward (it never counted)', async () => {
    const w = world({ settings: weekdaySettings({ requireStartToTrack: true }), tasks: [task(2)], events: [ev('m', '10:00', '11:00')] });
    await replan(w, at('08:00'));
    expect(await replan(w, at('10:30'))).toMatchObject({ created: 0, updated: 2, deleted: 0 });
    expect(times(w)).toEqual(['11:00–12:00', '12:00–13:00']);
    expect(spent(w, at('17:30'))).toBe(0);
  });
});

describe('B1 — a running piece stays put (automatic tracking)', () => {
  it('a piece that would still fit from now does not slide', async () => {
    const w = world({ tasks: [task(1)] });
    await replan(w, at('08:00'));
    expect(await replan(w, at('09:05'))).toMatchObject(noWrites);
    expect(await replan(w, at('09:07') + 17_000)).toMatchObject(noWrites); // off-grid poll
    expect(times(w)).toEqual(['09:00–10:00']);
    expect(spent(w, at('10:00'))).toBe(1 * H);
  });

  it('a piece that no longer fits before the next meeting does not jump past it', async () => {
    const w = world({ tasks: [task(1)], events: [ev('m1', '09:00', '10:00'), ev('m2', '11:00', '12:00')] });
    await replan(w, at('08:00'));
    expect(times(w)).toEqual(['10:00–11:00']);
    expect(await replan(w, at('10:05'))).toMatchObject(noWrites);
    expect(times(w)).toEqual(['10:00–11:00']);
  });

  it('boundaries: now == start freezes it, now == end hands it over to spent (two pieces back to back)', async () => {
    const w = world({ tasks: [task(2)] });
    await replan(w, at('08:00'));
    for (const t of ['09:00', '10:00', '11:00']) {
      expect(await replan(w, at(t)), t).toMatchObject(noWrites);
      expect(times(w), t).toEqual(['09:00–10:00', '10:00–11:00']);
    }
    expect(spent(w, at('10:00'))).toBe(1 * H); // the first counts, the second (running) does not yet
    expect(spent(w, at('11:00'))).toBe(2 * H);
  });

  it('the running piece counts toward the task: nothing extra is planned while it runs', async () => {
    const w = world({ tasks: [task(2)] });
    await replan(w, at('08:00'));
    await replan(w, at('09:30'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00']);
  });

  it('a meeting added on top of the running piece leaves it whole (they overlap)', async () => {
    const w = world({ tasks: [task(1)] });
    await replan(w, at('08:00'));
    w.events = [ev('m1', '09:30', '10:30')];
    expect(await replan(w, at('09:20'))).toMatchObject(noWrites);
    expect(times(w)).toEqual(['09:00–10:00']);
  });

  it('a higher-priority task created mid-piece is planned around it', async () => {
    const w = world({ tasks: [task(1, { priority: 2 })] });
    await replan(w, at('08:00'));
    w.tasks.push(task(1, { id: 't2', title: 'Urgent', priority: 0 }));
    await replan(w, at('09:20'));
    expect(times(w)).toEqual(['09:00–10:00']);
    expect(times(w, 't2')).toEqual(['10:00–11:00']);
  });

  it('duration shortened below what is done mid-piece: future pieces go, the frozen ones stay whole', async () => {
    const w = world({ tasks: [task(3)] });
    await replan(w, at('08:00'));
    w.tasks[0] = { ...w.tasks[0]!, durationMs: 1 * H };
    await replan(w, at('10:30'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00']);
    expect(spent(w, at('11:00'))).toBe(2 * H); // over-counts by up to one piece (accepted)
  });

  it('a task with frozen auto pieces AND a dragged (pinned) piece: both count, nothing is planned twice', async () => {
    const w = world({ tasks: [task(3)] });
    await replan(w, at('08:00'));
    const third = w.store.rows().find((r) => r.startsAt.getTime() === at('11:00'))!;
    Object.assign(third, { startsAt: new Date(at('14:00')), endsAt: new Date(at('15:00')), pinned: true }); // a drag
    await replan(w, at('10:30'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00', '14:00–15:00']);
    expect(spent(w, at('15:00'))).toBe(3 * H);
  });

  it('manual mode is unchanged: the un-started running piece still slides', async () => {
    const w = world({ settings: weekdaySettings({ requireStartToTrack: true }), tasks: [task(1)] });
    await replan(w, at('08:00'));
    expect(await replan(w, at('09:05'))).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(times(w)).toEqual(['09:05–10:05']);
  });
});

describe('a polled day (replans every 5 minutes, counting mirror)', () => {
  async function day(requireStartToTrack: boolean, hours: number, events: CalendarEvent[] = []) {
    const w = world({ settings: weekdaySettings({ requireStartToTrack }), tasks: [task(hours)], events });
    const { calls, mirror } = countingMirror();
    await replan(w, at('08:00'), mirror);
    const first = { ...calls };
    for (let t = at('08:00') + 137_000; t <= at('17:30'); t += 5 * M) await replan(w, t, mirror);
    return {
      spentH: spent(w, at('17:30')) / H,
      times: times(w),
      writes: { create: calls.create - first.create, update: calls.update - first.update, delete: calls.delete - first.delete },
    };
  }

  // Before the freeze: 0 h tracked and 159 (2 h) / 62 (3 h) event updates, the work ending up on Tuesday.
  it('automatic: the full 2 h is tracked on Monday and nothing moves', async () => {
    const r = await day(false, 2);
    expect(r.spentH).toBe(2);
    expect(r.times).toEqual(['09:00–10:00', '10:00–11:00']);
    // Without stable keys the hand-over to the second piece cost one insert and one delete.
    expect(r.writes).toEqual({ create: 0, update: 0, delete: 0 });
  });

  it('automatic, 3 h around two meetings: the full 3 h is tracked', async () => {
    const r = await day(false, 3, [ev('m1', '10:00', '11:00'), ev('m2', '13:00', '14:00')]);
    expect(r.spentH).toBe(3);
    expect(r.times).toEqual(['09:00–10:00', '11:00–12:00', '12:00–13:00']);
    expect(r.writes).toEqual({ create: 0, update: 0, delete: 0 }); // without stable keys: 2 / 1 / 2
  });

  it('manual (never pressing Start): unchanged, the pieces slide and nothing counts', async () => {
    const r = await day(true, 2);
    expect(r.spentH).toBe(0);
    expect(r.writes).toEqual({ create: 0, update: 159, delete: 0 });
    expect(r.times).toEqual(['01-06 09:00–10:00', '01-06 10:00–11:00']);
  });
});

describe('stable keys', () => {
  it('the first replan after a piece begins makes no write even when more pieces follow', async () => {
    const w = world({ tasks: [task(3)] });
    const { calls, mirror } = countingMirror();
    await replan(w, at('08:00'), mirror);
    const before = { ...calls };
    expect(await replan(w, at('09:02'), mirror)).toMatchObject(noWrites);
    expect(calls).toEqual(before);
    expect(keys(w)).toEqual(['task:t1:0', 'task:t1:1', 'task:t1:2']);
  });

  it('a longer task after its pieces are done gets new keys past the ones history holds', async () => {
    const w = world({ tasks: [task(1)] });
    await replan(w, at('08:00'));
    w.tasks[0] = { ...w.tasks[0]!, durationMs: 2 * H };
    expect(await replan(w, at('10:30'))).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    expect(keys(w)).toEqual(['task:t1:0', 'task:t1:1']);
    expect(times(w)).toEqual(['09:00–10:00', '10:30–11:30']);
  });
});

describe('a task completed while its piece runs (PATCH /tasks ends the piece like Stop)', () => {
  it('the rest of the piece is freed for the next task, and the stopped part counts', async () => {
    const w = world({ tasks: [task(2), task(1, { id: 't2', title: 'Next', priority: 2 })] });
    await replan(w, at('08:00'));
    expect(times(w)).toEqual(['09:00–10:00', '10:00–11:00']);
    expect(times(w, 't2')).toEqual(['11:00–12:00']);
    // 09:37: the task is completed; the server ends the running piece at round15 = 09:30 and pins it.
    w.tasks[0] = { ...w.tasks[0]!, status: 'completed' };
    const piece = w.store.rows().find((r) => r.taskId === 't1' && r.startsAt.getTime() === at('09:00'))!;
    Object.assign(piece, { endsAt: new Date(at('09:30')), pinned: true });
    await replan(w, at('09:37'));
    expect(times(w)).toEqual(['09:00–09:30']); // the piece not begun yet is swept
    expect(times(w, 't2')).toEqual(['09:40–10:40']);
    expect(spent(w, at('17:00'))).toBe(30 * M);
  });

  it('without ending it, the completed task would keep the slot busy until its planned end', async () => {
    const w = world({ tasks: [task(2), task(1, { id: 't2', title: 'Next', priority: 2 })] });
    await replan(w, at('08:00'));
    w.tasks[0] = { ...w.tasks[0]!, status: 'completed' };
    await replan(w, at('09:37'));
    expect(times(w)).toEqual(['09:00–10:00']);
    expect(times(w, 't2')).toEqual(['10:00–11:00']);
  });
});
