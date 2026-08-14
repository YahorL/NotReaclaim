import { describe, it, expect } from 'vitest';
import { schedule } from '../src/schedule.js';
import type { ScheduleInput } from '../src/types.js';

const baseInput = (): ScheduleInput => ({
  workingWindows: [{ start: 0, end: 1000 }],
  fixedEvents: [],
  pinnedBlocks: [],
  tasks: [],
  habits: [],
});

describe('schedule', () => {
  it('avoids fixed events and schedules higher-priority tasks first', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      fixedEvents: [{ id: 'm1', start: 0, end: 50 }],
      tasks: [
        { id: 'low', title: 'Low', priority: 5, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
        { id: 'high', title: 'High', priority: 1, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
      ],
    };
    const result = schedule(input);
    // free starts at 50 (after the meeting); 'high' goes first.
    expect(result.blocks).toEqual([
      { id: 'task:high:0', sourceType: 'task', sourceId: 'high', title: 'High', start: 50, end: 80 },
      { id: 'task:low:0', sourceType: 'task', sourceId: 'low', title: 'Low', start: 80, end: 110 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('treats pinned blocks as busy and echoes them in the output', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      pinnedBlocks: [
        { id: 'pin:1', sourceType: 'task', sourceId: 'x', title: 'Pinned', start: 0, end: 100 },
      ],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
      ],
    };
    const result = schedule(input);
    expect(result.blocks).toEqual([
      { id: 'pin:1', sourceType: 'task', sourceId: 'x', title: 'Pinned', start: 0, end: 100 },
      { id: 'task:t:0', sourceType: 'task', sourceId: 't', title: 'T', start: 100, end: 130 },
    ]);
  });

  it('surfaces tasks that cannot meet their deadline as unscheduled', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      workingWindows: [{ start: 0, end: 20 }],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: 60, dueBy: 20, minChunkMs: 20, maxChunkMs: 20 },
      ],
    };
    const result = schedule(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]!.sourceId).toBe('t');
  });
});

describe('sortOrder tiebreaker', () => {
  it('orders same-priority tasks by sortOrder before dueBy', () => {
    const mkT = (id: string, sortOrder: number, dueBy: number) =>
      ({ id, title: id, priority: 1, durationMs: 20, dueBy, minChunkMs: 20, maxChunkMs: 20, sortOrder });
    const res = schedule({
      workingWindows: [{ start: 0, end: 100 }], fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [mkT('a-late-due', 1, 90), mkT('b-early-due', 2, 50)],
    });
    // sortOrder 1 belongs to 'a-late-due'; it must be placed FIRST even though b-early-due has earlier dueBy
    expect(res.blocks.map((b) => b.sourceId)).toEqual(['a-late-due', 'b-early-due']);
  });
});

describe('preferred-first habit ordering', () => {
  const H = 3_600_000;
  const D = 24 * H;
  const M = 60_000;
  const WORK = { start: 10 * H, end: 17 * H };

  /** Same priority, same (implicit) order, same period start: only the new claim term separates them. */
  const habit = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: id, priority: 3, chunkMs: H, perPeriod: 1,
    periods: [{ start: 0, end: D }],
    allowedWindows: [{ start: 0, end: D }],
    ...over,
  });

  const morning = (id = 'z-morning') =>
    habit(id, { preferredWindows: [{ start: 10 * H, end: 11 * H }] });
  const cleanup = (id = 'a-cleanup') => habit(id, { chunkMs: 15 * M });

  const run = (habits: ReturnType<typeof habit>[]) =>
    schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], tasks: [],
      habits,
    });

  it('gives a preferred window to the habit that asked for it, not to a preference-less one', () => {
    // Live case: a 15-minute habit with no preference used to win the id tiebreak and
    // squat 10:00 — inside Morning Routine's exact 10:00-11:00 preferred window.
    const res = run([cleanup(), morning()]);
    expect(res.blocks.find((b) => b.sourceId === 'z-morning')).toMatchObject({ start: 10 * H, end: 11 * H });
  });

  it('places the preferred habit first regardless of id order', () => {
    for (const ids of [['a-pref', 'z-plain'], ['z-pref', 'a-plain']]) {
      const res = run([
        habit(ids[1]!, { chunkMs: 15 * M }),
        habit(ids[0]!, { preferredWindows: [{ start: 10 * H, end: 11 * H }] }),
      ]);
      expect(res.blocks.find((b) => b.sourceId === ids[0])).toMatchObject({ start: 10 * H, end: 11 * H });
    }
  });

  it('keeps the id tiebreak deterministic among equally-ranked habits', () => {
    const res = run([habit('b'), habit('a')]);
    expect(res.blocks.map((b) => b.sourceId)).toEqual(['a', 'b']);
  });

  it('places a habit before an overdue task of equal priority (inert inversion)', () => {
    // The ONE relation the claim term inverts: a task whose deadline precedes the habit's
    // period start used to sort first. It can never cost the habit a slot — a shared slot
    // would have to start at or after the habit's period start AND end at or before the
    // task's deadline, which is impossible once the deadline is the earlier of the two.
    // Here the deadline is behind the free timeline entirely, so the task places nothing.
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      tasks: [{ id: 't', title: 'T', priority: 3, durationMs: H, dueBy: 9 * H, minChunkMs: H, maxChunkMs: H }],
      habits: [habit('h', { periods: [{ start: 10 * H, end: D }] })],
    });
    expect(res.blocks.map((b) => [b.sourceId, b.start])).toEqual([['h', 10 * H]]);
    expect(res.unscheduled.map((u) => u.sourceId)).toEqual(['t']);
  });

  it('keeps a task and a preference-less habit of equal priority in their existing order', () => {
    // Characterization: a habit's `tie` is its period start (now) and a task's is its
    // dueBy (later), so habits have always been placed before same-priority tasks. The
    // claim term must not silently invert that.
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      tasks: [{ id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H }],
      habits: [habit('h')],
    });
    expect(res.blocks.map((b) => [b.sourceId, b.start])).toEqual([
      ['h', 10 * H],
      ['t', 11 * H],
    ]);
  });
});

describe('horizon (full-day free envelope)', () => {
  const H = 3_600_000;
  const D = 24 * H;
  const WORK = { start: 10 * H, end: 17 * H };

  const eveningHabit = () => ({
    id: 'h', title: 'Evening Routine', priority: 1, chunkMs: H, perPeriod: 1,
    periods: [{ start: 0, end: D }],
    allowedWindows: [{ start: 0, end: D }], // core emits full eligible days
    preferredWindows: [{ start: 22 * H, end: 23 * H }],
  });

  const oneHourTask = (over = {}) => ({
    id: 't', title: 'T', priority: 1, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H, ...over,
  });

  it('places a habit outside working hours, in its preferred window', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], tasks: [],
      habits: [eveningHabit()],
    });
    expect(res.blocks).toEqual([
      { id: 'habit:h:0', sourceType: 'habit', sourceId: 'h', title: 'Evening Routine', start: 22 * H, end: 23 * H },
    ]);
    expect(res.unscheduled).toEqual([]);
  });

  it('still confines a task without allowedWindows to the working windows', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [oneHourTask()],
    });
    expect(res.blocks).toEqual([
      { id: 'task:t:0', sourceType: 'task', sourceId: 't', title: 'T', start: 10 * H, end: 11 * H },
    ]);
  });

  it('clips a task\'s own allowedWindows to the working windows', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [oneHourTask({ allowedWindows: [{ start: 8 * H, end: 12 * H }] })],
    });
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
  });

  it('leaves a task unscheduled when its allowedWindows lie wholly outside working hours', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [oneHourTask({ allowedWindows: [{ start: 2 * H, end: 6 * H }] })],
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled[0]).toMatchObject({ sourceId: 't', remainingMs: H });
  });

  it('lets a fixed event outside working hours consume habit free time', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [{ id: 'e', start: 22 * H, end: 22 * H + 30 * 60_000 }],
      pinnedBlocks: [], tasks: [],
      habits: [eveningHabit()],
    });
    // 22:00–22:30 is busy, so the 1h chunk no longer fits the preferred window —
    // and the fallback is working hours, NOT the small hours of the morning.
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
  });

  it('falls a habit back to working hours when its preferred window is too small', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], tasks: [],
      habits: [{ ...eveningHabit(), preferredWindows: [{ start: 22 * H, end: 22 * H + 30 * 60_000 }] }],
    });
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
  });

  it('falls a habit back to the rest of the day only when working hours are full too', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      // Working hours booked solid AND the preferred window booked solid.
      fixedEvents: [
        { id: 'work', start: 10 * H, end: 17 * H },
        { id: 'eve', start: 22 * H, end: 23 * H },
      ],
      pinnedBlocks: [], tasks: [],
      habits: [eveningHabit()],
    });
    // Deliberate last resort: with neither preference nor working hours available,
    // the habit takes the earliest free time of the eligible day — midnight.
    expect(res.blocks[0]).toMatchObject({ start: 0, end: H });
  });

  it('schedules no tasks but still places habits when workingWindows is empty', () => {
    const res = schedule({
      workingWindows: [],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      tasks: [oneHourTask()],
      habits: [eveningHabit()],
    });
    // Tasks are confined to working hours, of which there are none.
    expect(res.unscheduled.map((u) => u.sourceId)).toEqual(['t']);
    // Habits roam the full day, so the empty working hours mean 24/7 availability.
    expect(res.blocks).toEqual([
      { id: 'habit:h:0', sourceType: 'habit', sourceId: 'h', title: 'Evening Routine', start: 22 * H, end: 23 * H },
    ]);
  });

  it('does not let a habit steal another habit\'s preferred window', () => {
    const morning = {
      id: 'm', title: 'Morning', priority: 2, chunkMs: H, perPeriod: 1,
      periods: [{ start: 0, end: D }],
      allowedWindows: [{ start: 0, end: D }],
      preferredWindows: [{ start: 10 * H, end: 11 * H }],
    };
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [], tasks: [],
      habits: [eveningHabit(), morning], // evening has the better priority, goes first
    });
    expect(res.blocks.map((b) => [b.sourceId, b.start, b.end])).toEqual([
      ['m', 10 * H, 11 * H],
      ['h', 22 * H, 23 * H],
    ]);
  });

  it('without horizon, keeps confining habits to the working windows (regression)', () => {
    const res = schedule({
      workingWindows: [WORK],
      fixedEvents: [], pinnedBlocks: [], tasks: [],
      habits: [eveningHabit()],
    });
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
  });
});

describe('blockBufferMs vs habit preferred windows', () => {
  const H = 3_600_000;
  const M = 60_000;
  const D = 24 * H;
  const G = 15 * M;
  const WORK = { start: 10 * H, end: 18 * H };

  const prefHabit = (id: string, chunkMs: number, w: { start: number; end: number }) => ({
    id, title: id, priority: 3, chunkMs, perPeriod: 1,
    periods: [{ start: 0, end: D }],
    allowedWindows: [{ start: 0, end: D }],
    preferredWindows: [w],
  });

  /** Morning Routine (1h, 10:00–11:00) + CleanUp (15m, 11:00–11:15) — the live case. */
  const pair = (morningId: string, cleanupId: string) => [
    prefHabit(morningId, H, { start: 10 * H, end: 11 * H }),
    prefHabit(cleanupId, 15 * M, { start: 11 * H, end: 11 * H + 15 * M }),
  ];

  const run = (
    habits: ScheduleInput['habits'],
    tasks: ScheduleInput['tasks'] = [],
    fixedEvents: ScheduleInput['fixedEvents'] = [],
  ) =>
    schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents,
      pinnedBlocks: [],
      tasks,
      habits,
      blockBufferMs: G,
    });

  it('places both abutting preferred windows exactly, in either placement order', () => {
    // Ids decide the order among equally-ranked preferred habits, so flip them to
    // cover both: neither habit's buffer may eat into the other's exact window.
    for (const [morningId, cleanupId] of [['a-morning', 'z-cleanup'], ['z-morning', 'a-cleanup']]) {
      const res = run(pair(morningId!, cleanupId!));
      expect(res.blocks.find((b) => b.sourceId === morningId)).toMatchObject({
        start: 10 * H, end: 11 * H,
      });
      expect(res.blocks.find((b) => b.sourceId === cleanupId)).toMatchObject({
        start: 11 * H, end: 11 * H + 15 * M,
      });
    }
  });

  it('keeps the buffer between the last window block and a following task', () => {
    // A window placement reserves its ± gap everywhere EXCEPT inside some habit's
    // preferred window, so CleanUp still gets 11:00–11:15 while a task is held off
    // until 11:30.
    const res = run(pair('a-morning', 'z-cleanup'), [
      { id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
    ]);
    const task = res.blocks.find((b) => b.sourceType === 'task')!;
    expect(task.start).toBeGreaterThanOrEqual(11 * H + 15 * M + G);
  });

  it('keeps the buffer between a window block and a following preference-less habit', () => {
    const res = run([
      prefHabit('a-morning', H, { start: 10 * H, end: 11 * H }),
      // No preferred windows → claim rank 1, so it is placed after the window habit
      // and must respect that block's trailing pad (tier-2, working hours).
      { id: 'z-anytime', title: 'z-anytime', priority: 3, chunkMs: H, perPeriod: 1,
        periods: [{ start: 0, end: D }], allowedWindows: [{ start: 0, end: D }] },
    ]);
    const morning = res.blocks.find((b) => b.sourceId === 'a-morning')!;
    const anytime = res.blocks.find((b) => b.sourceId === 'z-anytime')!;
    expect(morning).toMatchObject({ start: 10 * H, end: 11 * H });
    expect(anytime.start - morning.end).toBeGreaterThanOrEqual(G);
  });

  // R23 (was a characterization of the R22 hole): the padding is skipped over EVERY
  // habit's preferred window at placement time, whether or not that habit actually
  // claims it. Once the last habit has been processed, the margins nothing claimed
  // are re-reserved, so the next item can no longer sit flush against Morning.
  it('re-reserves a margin suspended over a window no habit claimed', () => {
    const cleanup = {
      ...prefHabit('z-cleanup', 15 * M, { start: 11 * H, end: 11 * H + 15 * M }),
      consumedSlotTimes: [12 * H], // its only day is taken → it places nothing
    };
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      habits: [prefHabit('a-morning', H, { start: 10 * H, end: 11 * H }), cleanup],
      tasks: [
        { id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
      ],
      blockBufferMs: G,
    });
    expect(res.blocks.filter((b) => b.sourceId === 'z-cleanup')).toEqual([]);
    expect(res.blocks.find((b) => b.sourceType === 'task')!.start).toBeGreaterThanOrEqual(
      11 * H + G,
    );
  });

  // The live R23 case: CleanUp's window is WIDER than its 15-minute chunk, so the
  // part of it that CleanUp does not occupy is a declared-but-unclaimed margin.
  it('re-reserves the margin left inside a habit\'s own wider window', () => {
    const res = run(
      [
        prefHabit('a-morning', H, { start: 10 * H, end: 11 * H }),
        prefHabit('z-cleanup', 15 * M, { start: 11 * H, end: 12 * H }),
      ],
      [{ id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H }],
    );
    expect(res.blocks.find((b) => b.sourceId === 'a-morning')).toMatchObject({
      start: 10 * H, end: 11 * H,
    });
    expect(res.blocks.find((b) => b.sourceId === 'z-cleanup')).toMatchObject({
      start: 11 * H, end: 11 * H + 15 * M,
    });
    expect(res.blocks.find((b) => b.sourceType === 'task')!.start).toBeGreaterThanOrEqual(
      11 * H + 15 * M + G,
    );
  });

  it('re-reserves the unclaimed margin of a sticky in-window kept slot', () => {
    const res = run(
      [
        {
          ...prefHabit('a-morning', H, { start: 10 * H, end: 12 * H }),
          existingSlots: [{ start: 10 * H, end: 11 * H }],
        },
      ],
      [{ id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H }],
    );
    expect(res.blocks.find((b) => b.sourceId === 'a-morning')).toMatchObject({
      start: 10 * H, end: 11 * H,
    });
    expect(res.blocks.find((b) => b.sourceType === 'task')!.start).toBeGreaterThanOrEqual(
      11 * H + G,
    );
  });

  it('re-reserves nothing when there are no habits, and leaves tasks alone', () => {
    const res = run([], [
      { id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
    ]);
    expect(res.blocks).toMatchObject([{ sourceId: 't', start: 10 * H, end: 11 * H }]);
  });

  // Documented limitation: reconciliation runs after the LAST habit, so a task that
  // outranks some habit places before it and may still sit flush against an earlier
  // habit's suspended margin. Unreachable with real data (all habits are priority 0).
  it('does not protect a task that outranks a habit (known limitation)', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      habits: [
        { ...prefHabit('a-morning', H, { start: 10 * H, end: 11 * H }), priority: 0 },
        { ...prefHabit('z-cleanup', 15 * M, { start: 11 * H, end: 12 * H }), priority: 2 },
      ],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: 15 * M, dueBy: D, minChunkMs: 15 * M, maxChunkMs: 15 * M },
      ],
      blockBufferMs: G,
    });
    // Placed between the two habits → flush against Morning's suspended margin.
    expect(res.blocks.find((b) => b.sourceType === 'task')).toMatchObject({ start: 11 * H });
  });

  it('keeps the buffer between a task and a habit window placed after it', () => {
    // The other order still buffers: the task reserves [start − gap, end + gap],
    // and the habit's tier-1 fit respects that reservation like any other.
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
      ],
      habits: [prefHabit('h', H, { start: 11 * H, end: 12 * H })],
      blockBufferMs: G,
    });
    const task = res.blocks.find((b) => b.sourceType === 'task')!;
    const habit = res.blocks.find((b) => b.sourceType === 'habit')!;
    expect(task).toMatchObject({ start: 10 * H, end: 11 * H });
    expect(habit.start - task.end).toBeGreaterThanOrEqual(G);
  });

  it('still buffers a habit that fell back OUT of its preferred window', () => {
    const res = schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks: [],
      // Preferred window far too small for the 1h chunk → tier-2 fallback, which
      // keeps the full two-sided reservation.
      habits: [prefHabit('h', H, { start: 22 * H, end: 22 * H + M })],
      tasks: [
        { id: 't', title: 'T', priority: 4, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
      ],
      blockBufferMs: G,
    });
    const habit = res.blocks.find((b) => b.sourceType === 'habit')!;
    const task = res.blocks.find((b) => b.sourceType === 'task')!;
    expect(habit).toMatchObject({ start: 10 * H, end: 11 * H });
    expect(task.start - habit.end).toBeGreaterThanOrEqual(G);
  });

  it('fits an exact-size preferred window between two abutting fixed events', () => {
    const res = run([prefHabit('h', H, { start: 10 * H, end: 11 * H })], [], [
      { id: 'before', start: 9 * H, end: 10 * H },
      { id: 'after', start: 11 * H, end: 12 * H },
    ]);
    expect(res.blocks.find((b) => b.sourceType === 'habit')).toMatchObject({
      start: 10 * H, end: 11 * H,
    });
  });
});

describe('blockBufferMs', () => {
  it('spaces two consecutive tasks by the buffer', () => {
    const mk = (id: string) => ({ id, title: id, priority: 1, durationMs: 20, dueBy: 100, minChunkMs: 20, maxChunkMs: 20 });
    const res = schedule({ workingWindows: [{ start: 0, end: 100 }], fixedEvents: [], pinnedBlocks: [], tasks: [mk('a'), mk('b')], habits: [], blockBufferMs: 10 });
    const a = res.blocks.find((b) => b.sourceId === 'a')!;
    const b = res.blocks.find((b) => b.sourceId === 'b')!;
    expect(b.start - a.end).toBe(10);
  });

  it('keeps blockBufferMs distance on both sides of a pinned block', () => {
    const H = 3_600_000;
    const G = 900_000;
    const res = schedule({
      workingWindows: [{ start: 9 * H, end: 18 * H }],
      fixedEvents: [],
      pinnedBlocks: [
        { id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 11 * H, end: 12 * H },
      ],
      tasks: [
        { id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H },
        { id: 'b', title: 'B', priority: 2, durationMs: 4 * H, dueBy: 24 * H, minChunkMs: 4 * H, maxChunkMs: 4 * H },
      ],
      habits: [],
      blockBufferMs: G,
    });
    const auto = res.blocks.filter((b) => b.id !== 'pin');
    expect(auto.length).toBeGreaterThan(0);
    for (const b of auto) {
      expect(b.end <= 11 * H - G || b.start >= 12 * H + G).toBe(true);
    }
  });

  // The two-sided assertion above still passes if only TRAILING padding is applied,
  // because the task can flee to the right of the pinned block. Pin the LEADING pad
  // specifically: the working window ends exactly where the pinned block starts, so
  // 9:00-11:00 is the only candidate and without a leading pad the task lands flush.
  it('refuses a task that would butt up against a pinned block from the left', () => {
    const H = 3_600_000;
    const G = 900_000;
    const res = schedule({
      workingWindows: [{ start: 9 * H, end: 11 * H }],
      fixedEvents: [],
      pinnedBlocks: [
        { id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 11 * H, end: 12 * H },
      ],
      tasks: [
        { id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H },
      ],
      habits: [],
      blockBufferMs: G,
    });
    expect(res.blocks.map((b) => b.id)).toEqual(['pin']);
    expect(res.unscheduled).toHaveLength(1);
    expect(res.unscheduled[0]!.sourceId).toBe('a');
  });

  it('keeps blockBufferMs distance between an auto task and an auto habit', () => {
    const H = 3_600_000;
    const G = 900_000;
    const DAY = { start: 9 * H, end: 18 * H };
    const res = schedule({
      workingWindows: [DAY],
      fixedEvents: [],
      pinnedBlocks: [],
      tasks: [
        { id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H },
      ],
      habits: [
        {
          id: 'h', title: 'H', priority: 2, chunkMs: H, perPeriod: 1,
          periods: [{ start: 0, end: 24 * H }],
          allowedWindows: [{ start: 0, end: 24 * H }],
        },
      ],
      blockBufferMs: G,
    });
    const task = res.blocks.find((b) => b.sourceType === 'task')!;
    const habit = res.blocks.find((b) => b.sourceType === 'habit')!;
    expect(habit).toBeDefined();
    const distance = habit.start >= task.end ? habit.start - task.end : task.start - habit.end;
    expect(distance).toBeGreaterThanOrEqual(G);
  });

  it('echoes pinned blocks with their verbatim (unpadded) geometry', () => {
    const H = 3_600_000;
    const G = 900_000;
    const res = schedule({
      workingWindows: [{ start: 9 * H, end: 18 * H }],
      fixedEvents: [],
      pinnedBlocks: [
        { id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 11 * H, end: 12 * H },
      ],
      tasks: [],
      habits: [],
      blockBufferMs: G,
    });
    expect(res.blocks).toEqual([
      { id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 11 * H, end: 12 * H },
    ]);
  });

  it('does not apply blockBufferMs to fixed events', () => {
    const H = 3_600_000;
    const G = 900_000;
    const res = schedule({
      workingWindows: [{ start: 9 * H, end: 18 * H }],
      fixedEvents: [{ id: 'e', start: 11 * H, end: 12 * H }],
      pinnedBlocks: [],
      tasks: [
        { id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H },
      ],
      habits: [],
      blockBufferMs: G,
    });
    // flush against a fixed event is allowed: meeting padding is meetingBufferMs' job in core.
    expect(res.blocks[0]).toMatchObject({ start: 9 * H, end: 11 * H });
  });
});
