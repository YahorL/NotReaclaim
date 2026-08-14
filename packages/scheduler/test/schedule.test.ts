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

  // R25 REVERSED the R22 centerpiece (was: "places both abutting preferred windows
  // exactly, in either placement order"). With universal buffers two exactly-sized
  // ABUTTING windows can no longer both be honored — the user accepted this: whoever
  // claims first keeps its window, the other relocates with a full gap. Both habits
  // have slack 0 here, so the id tiebreak decides, and the test covers both ids.
  // See docs/superpowers/specs/2026-08-13-notreclaim-review-25-gap-preferring-windows-design.md
  it('gives an abutting exact window to whichever habit claims first, relocating the other', () => {
    for (const [morningId, cleanupId] of [['a-morning', 'z-cleanup'], ['z-morning', 'a-cleanup']]) {
      const res = run(pair(morningId!, cleanupId!));
      const morning = res.blocks.find((b) => b.sourceId === morningId)!;
      const cleanup = res.blocks.find((b) => b.sourceId === cleanupId)!;
      const [first, second] = morningId! < cleanupId!
        ? [morning, cleanup]
        : [cleanup, morning];
      // The habit that sorts first gets exactly the window it asked for…
      const firstWindow = morningId! < cleanupId!
        ? { start: 10 * H, end: 11 * H }
        : { start: 11 * H, end: 11 * H + 15 * M };
      expect(first).toMatchObject(firstWindow);
      // …and the other is pushed out of its window, keeping the full buffer.
      expect(
        Math.min(Math.abs(second!.start - first!.end), Math.abs(first!.start - second!.end)),
      ).toBeGreaterThanOrEqual(G);
    }
  });

  it('keeps the buffer between the last window block and a following task', () => {
    // Whatever the habits ended up doing with their abutting windows, the task that
    // follows them is held off by a full buffer.
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

  // R25: a sticky kept slot reserves its ± gap uniformly, so the following task is
  // buffered without any reconciliation step (was: "re-reserves the unclaimed margin
  // of a sticky in-window kept slot").
  it('buffers a task after a sticky kept slot inside a wider window', () => {
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

  it('leaves tasks alone when there are no habits', () => {
    const res = run([], [
      { id: 't', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H },
    ]);
    expect(res.blocks).toMatchObject([{ sourceId: 't', start: 10 * H, end: 11 * H }]);
  });

  // R25 flipped this (was: "does not protect a task that outranks a habit (known
  // limitation)", asserting the task landed flush at 11:00). Universal buffers close
  // that hole outright: there is no suspended margin for a task to land in, whatever
  // the priority interleaving.
  it('buffers a task that outranks a habit (the R23 hole is gone)', () => {
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
    // Placed between the two habits, buffered on both sides.
    const morning = res.blocks.find((b) => b.sourceId === 'a-morning')!;
    const task = res.blocks.find((b) => b.sourceType === 'task')!;
    const cleanup = res.blocks.find((b) => b.sourceId === 'z-cleanup')!;
    expect(task.start - morning.end).toBeGreaterThanOrEqual(G);
    expect(cleanup.start - task.end).toBeGreaterThanOrEqual(G);
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

// R25 — universal buffers + tightest-window-first ordering; see
// docs/superpowers/specs/2026-08-13-notreclaim-review-25-gap-preferring-windows-design.md
describe('universal buffers and habit claim order (R25)', () => {
  const H = 3_600_000;
  const M = 60_000;
  const D = 24 * H;
  const G = 10 * M; // the user's real block buffer
  const WORK = { start: 10 * H, end: 17 * H };

  const habit = (
    id: string,
    chunkMs: number,
    w?: { start: number; end: number },
  ): ScheduleInput['habits'][number] => ({
    id, title: id, priority: 3, chunkMs, perPeriod: 1,
    periods: [{ start: 0, end: D }],
    allowedWindows: [{ start: 0, end: D }],
    ...(w ? { preferredWindows: [w] } : {}),
  });

  const run = (
    habits: ScheduleInput['habits'],
    tasks: ScheduleInput['tasks'] = [],
    pinnedBlocks: ScheduleInput['pinnedBlocks'] = [],
  ) =>
    schedule({
      workingWindows: [WORK],
      horizon: { start: 0, end: D },
      fixedEvents: [], pinnedBlocks,
      tasks, habits,
      blockBufferMs: G,
    });

  /** The user's live layout: an exact Morning window, a wide CleanUp one, a task. */
  const live = (morningId: string, cleanupId: string) => [
    habit(morningId, H, { start: 10 * H, end: 11 * H }),
    habit(cleanupId, 15 * M, { start: 11 * H, end: 22 * H }),
  ];
  const research = {
    id: 't', title: 'Research', priority: 3,
    durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H,
  };

  it('lays out the live case with a gap after every block, in either placement order', () => {
    for (const [morningId, cleanupId] of [['a-morning', 'z-cleanup'], ['z-morning', 'a-cleanup']]) {
      const res = run(live(morningId!, cleanupId!), [research]);
      // Morning has slack 0 and claims its exact window; CleanUp's window is wide
      // enough to take the buffer, so it starts 10 minutes after Morning ends; the
      // task then starts 10 minutes after CleanUp.
      expect(res.blocks.find((b) => b.sourceId === morningId)).toMatchObject({
        start: 10 * H, end: 11 * H,
      });
      expect(res.blocks.find((b) => b.sourceId === cleanupId)).toMatchObject({
        start: 11 * H + 10 * M, end: 11 * H + 25 * M,
      });
      expect(res.blocks.find((b) => b.sourceType === 'task')!.start).toBeGreaterThanOrEqual(
        11 * H + 35 * M,
      );
    }
  });

  it('produces the identical layout whichever way the ids sort', () => {
    // Stronger than the per-id assertions above: the claim key must make the habit
    // ids irrelevant to the SHAPE of the plan, not just to two spot checks.
    const layout = (morningId: string, cleanupId: string) =>
      run(live(morningId, cleanupId), [research]).blocks.map((b) => [b.start, b.end]);
    expect(layout('z-morning', 'a-cleanup')).toEqual(layout('a-morning', 'z-cleanup'));
  });

  it('claims windows tightest-first: slack 0, then wide, then window-less, then tasks', () => {
    // All four want 10:00. Ids are chosen so that every one of them would sort BEFORE
    // the exact-window habit if the claim key did not exist.
    const res = run(
      [
        habit('a-wide', H, { start: 10 * H, end: 14 * H }),
        habit('b-anytime', H),
        habit('z-exact', H, { start: 10 * H, end: 11 * H }),
      ],
      [{ id: 'a-task', title: 'T', priority: 3, durationMs: H, dueBy: D, minChunkMs: H, maxChunkMs: H }],
    );
    expect(res.blocks.map((b) => b.title)).toEqual(['z-exact', 'a-wide', 'b-anytime', 'T']);
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
    // Everything after it is spaced by the buffer.
    for (let i = 1; i < res.blocks.length; i++) {
      expect(res.blocks[i]!.start - res.blocks[i - 1]!.end).toBeGreaterThanOrEqual(G);
    }
  });

  it('breaks slack ties deterministically by id', () => {
    const ids = ['b-two', 'a-one'];
    const res = run(ids.map((id) => habit(id, H, { start: 10 * H, end: 12 * H })));
    expect(res.blocks.map((b) => b.title)).toEqual(['a-one', 'b-two']);
  });

  it('fills an exact window whose interior is free (the fit ignores the buffer)', () => {
    // Working hours START at 10:00, so the window has no room for a leading pad — the
    // fit never consults gapMs, so it is placed exactly and pads outward only.
    const res = run([habit('h', H, { start: 10 * H, end: 11 * H })]);
    expect(res.blocks[0]).toMatchObject({ start: 10 * H, end: 11 * H });
  });

  it('relocates an exact-window habit when a pinned block\'s padding intrudes', () => {
    // Pre-existing behavior, now pinned: pinned blocks pad ± gap into the busy set,
    // so 10:00–11:00 is no longer wholly free and the habit falls back a tier.
    const res = run([habit('h', H, { start: 10 * H, end: 11 * H })], [], [
      { id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 9 * H, end: 10 * H },
    ]);
    expect(res.blocks.find((b) => b.sourceId === 'h')!.start).toBeGreaterThanOrEqual(10 * H + G);
  });

  it('keeps the Evening Routine in its exact 23:29-23:59 window (R24 alignment intact)', () => {
    const evening = {
      ...habit('evening', 30 * M, { start: 23 * H + 29 * M, end: 23 * H + 59 * M }),
    };
    const res = run([...live('a-morning', 'z-cleanup'), evening], [research]);
    expect(res.blocks.find((b) => b.sourceId === 'evening')).toMatchObject({
      start: 23 * H + 29 * M, end: 23 * H + 59 * M,
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
