import { describe, it, expect } from 'vitest';
import { scheduleTask } from '../src/items.js';
import type { FlexibleTask } from '../src/types.js';
import { scheduleHabit } from '../src/items.js';
import type { Habit } from '../src/types.js';

const task = (over: Partial<FlexibleTask> = {}): FlexibleTask => ({
  id: 't1',
  title: 'Write report',
  priority: 1,
  durationMs: 60,
  dueBy: 1000,
  minChunkMs: 15,
  maxChunkMs: 30,
  ...over,
});

describe('scheduleTask', () => {
  it('places chunks and returns blocks with deterministic ids', () => {
    const free = [{ start: 0, end: 100 }];
    const result = scheduleTask(free, task());
    expect(result.blocks).toEqual([
      { id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 0, end: 30 },
      { id: 'task:t1:1', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
    expect(result.free).toEqual([{ start: 60, end: 100 }]);
  });

  it('reports unplaced time when free space runs out before the due date', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleTask(free, task({ durationMs: 60 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'task',
        sourceId: 't1',
        title: 'Write report',
        reason: 'insufficient free time before due date',
        remainingMs: 30,
      },
    ]);
  });
});

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Exercise',
  priority: 2,
  chunkMs: 30,
  perPeriod: 2,
  periods: [{ start: 0, end: 1000 }],
  ...over,
});

describe('scheduleHabit', () => {
  it('places perPeriod occurrences within the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit());
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 0, end: 30 },
      { id: 'habit:h1:1', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('prefers preferredWindows but falls back to any free time in the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(
      free,
      habit({ perPeriod: 1, preferredWindows: [{ start: 500, end: 600 }] }),
    );
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 500, end: 530 },
    ]);
  });

  it('falls back to free time in the period when preferred windows lie outside it', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(
      free,
      habit({ perPeriod: 1, periods: [{ start: 0, end: 100 }], preferredWindows: [{ start: 500, end: 600 }] }),
    );
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 0, end: 30 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('reports missed occurrences when free time is exhausted', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'habit',
        sourceId: 'h1',
        title: 'Exercise',
        reason: 'could not place all habit occurrences in free time',
        remainingMs: 30,
      },
    ]);
  });
});

describe('scheduleHabit with allowedWindows (hard restriction)', () => {
  it('places within preferred ∩ allowed', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 100, end: 200 }],
      preferredWindows: [{ start: 150, end: 300 }],
    }));
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 150, end: 180 },
    ]);
  });

  it('falls back to allowed (not outside) when preferred does not fit', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 0, end: 200 }],
      preferredWindows: [{ start: 0, end: 20 }],
    }));
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
  });

  it('leaves an occurrence unscheduled rather than placing outside allowedWindows', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 500, end: 520 }],
    }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]).toMatchObject({ sourceId: 'h1', remainingMs: 30 });
  });

  it('does not place a second occurrence outside the allowed window', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      // Two windows, so the one-per-day cap is not what blocks the second
      // occurrence: the remaining window is simply too short for a 30ms chunk.
      allowedWindows: [{ start: 0, end: 40 }, { start: 100, end: 120 }],
    }));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
    expect(result.unscheduled[0]).toMatchObject({ remainingMs: 30 });
  });

  it('schedules nothing when allowedWindows is empty', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({ perPeriod: 1, allowedWindows: [] }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled[0]).toMatchObject({ sourceId: 'h1', remainingMs: 30 });
  });
});

describe('scheduleHabit one occurrence per allowed-window day', () => {
  const D = 86_400_000;
  const H = 3_600_000;

  const dayWindows = (days: number[], fromH = 9, toH = 17) =>
    days.map((d) => ({ start: d * D + fromH * H, end: d * D + toH * H }));

  it('places at most one occurrence per allowed-window day', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 3,
      periods: [{ start: 0, end: 7 * D }],
      allowedWindows: dayWindows([0, 1, 2, 3, 4]),
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    const days = res.blocks.map((b) => Math.floor(b.start / D));
    expect(res.blocks).toHaveLength(3);
    expect(new Set(days).size).toBe(3);
    expect(days).toEqual([0, 1, 2]);
    expect(res.unscheduled).toEqual([]);
  });

  it('reports surplus occurrences as missed when eligible days run out', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 3,
      periods: [{ start: 0, end: 7 * D }],
      allowedWindows: dayWindows([0, 1]),
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks).toHaveLength(2);
    expect(res.unscheduled).toEqual([
      {
        sourceType: 'habit',
        sourceId: 'h',
        title: 'H',
        reason: 'could not place all habit occurrences in free time',
        remainingMs: H,
      },
    ]);
  });

  it('does not reuse a day consumed via a preferred window', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 2,
      periods: [{ start: 0, end: 7 * D }],
      allowedWindows: dayWindows([0, 1]),
      // Day 0 has a wide preferred window; day 1 has none.
      preferredWindows: [{ start: 9 * H, end: 17 * H }],
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks.map((b) => Math.floor(b.start / D))).toEqual([0, 1]);
  });

  it('consumes the day even when placed via the bound fallback', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 2,
      periods: [{ start: 0, end: 7 * D }],
      allowedWindows: dayWindows([0, 1]),
      // Preferred windows never fit (too short), so both placements use `bound`.
      preferredWindows: [0, 1].map((d) => ({ start: d * D + 9 * H, end: d * D + 9 * H + 60_000 })),
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks.map((b) => Math.floor(b.start / D))).toEqual([0, 1]);
  });

  it('carries consumed days across periods', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 1,
      periods: [{ start: 0, end: 7 * D }, { start: 7 * D, end: 14 * D }],
      // A single allowed entry straddling the period boundary: period 1 consumes
      // it, so period 2 has nothing left. A per-period budget would place twice.
      allowedWindows: [{ start: 7 * D - 4 * H, end: 7 * D + 4 * H }],
    };
    const res = scheduleHabit([{ start: 0, end: 14 * D }], h, 0);
    expect(res.blocks.map((b) => [b.start, b.end])).toEqual([[7 * D - 4 * H, 7 * D - 3 * H]]);
    expect(res.unscheduled).toEqual([
      {
        sourceType: 'habit',
        sourceId: 'h',
        title: 'H',
        reason: 'could not place all habit occurrences in free time',
        remainingMs: H,
      },
    ]);
  });

  it('still places once per period when each period has its own eligible day', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 1,
      periods: [{ start: 0, end: 7 * D }, { start: 7 * D, end: 14 * D }],
      allowedWindows: dayWindows([0, 7]),
    };
    const res = scheduleHabit([{ start: 0, end: 14 * D }], h, 0);
    expect(res.blocks.map((b) => Math.floor(b.start / D))).toEqual([0, 7]);
    expect(res.unscheduled).toEqual([]);
  });

  it('leaves habits without allowedWindows uncapped (regression)', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 3,
      periods: [{ start: 0, end: 7 * D }],
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks.map((b) => [b.start, b.end])).toEqual([
      [0, H], [H, 2 * H], [2 * H, 3 * H],
    ]);
  });
});

describe('scheduleHabit existingSlots (sticky placements)', () => {
  const D = 86_400_000;
  const H = 3_600_000;

  const dayWindows = (days: number[], fromH = 9, toH = 17) =>
    days.map((d) => ({ start: d * D + fromH * H, end: d * D + toH * H }));

  const stickyHabit = (over: Partial<Habit> = {}): Habit => ({
    id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 2,
    periods: [{ start: 0, end: 7 * D }],
    allowedWindows: dayWindows([0, 1, 2, 3, 4]),
    ...over,
  });

  const spans = (res: { blocks: { start: number; end: number }[] }) =>
    res.blocks.map((b) => ({ start: b.start, end: b.end }));

  it('keeps a valid existing slot verbatim', () => {
    const h = stickyHabit({ existingSlots: [{ start: 1 * D + 13 * H, end: 1 * D + 14 * H }] });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(spans(res)).toContainEqual({ start: 1 * D + 13 * H, end: 1 * D + 14 * H });
    expect(res.blocks).toHaveLength(2); // kept slot counts toward perPeriod
    expect(res.unscheduled).toEqual([]);
  });

  it('emits kept slots first so their engineKeys stay stable', () => {
    const h = stickyHabit({ existingSlots: [{ start: 1 * D + 13 * H, end: 1 * D + 14 * H }] });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks[0]).toMatchObject({
      id: 'habit:h:0', start: 1 * D + 13 * H, end: 1 * D + 14 * H,
    });
    expect(res.blocks[1]!.id).toBe('habit:h:1');
  });

  it('re-places a slot that no longer fits in free time', () => {
    const slot = { start: 1 * D + 13 * H, end: 1 * D + 14 * H };
    const h = stickyHabit({ existingSlots: [slot] });
    // Day 1 is entirely busy, so the stale slot cannot be kept.
    const res = scheduleHabit([{ start: 0, end: 1 * D }, { start: 2 * D, end: 7 * D }], h, 0);
    expect(res.blocks).toHaveLength(2);
    expect(spans(res)).not.toContainEqual(slot);
    expect(res.blocks.map((b) => Math.floor(b.start / D))).toEqual([0, 2]);
  });

  it('kept slot consumes its day (no second occurrence that day)', () => {
    const h = stickyHabit({ existingSlots: [{ start: 1 * D + 13 * H, end: 1 * D + 14 * H }] });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    const autoDays = res.blocks
      .filter((b) => b.start !== 1 * D + 13 * H)
      .map((b) => Math.floor(b.start / D));
    expect(autoDays).toEqual([0]);
  });

  it('reserves the gap around a kept slot', () => {
    const h = stickyHabit({
      perPeriod: 2,
      allowedWindows: [{ start: 0, end: 4 * H }],
      existingSlots: [{ start: 2 * H, end: 3 * H }],
    });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 30 * 60_000);
    // Day consumed by the kept slot → only one block, and the free time it
    // released must exclude [slot.start − gap, slot.end + gap].
    expect(spans(res)).toEqual([{ start: 2 * H, end: 3 * H }]);
    expect(res.free).toEqual([
      { start: 0, end: 1.5 * H },
      { start: 3.5 * H, end: 7 * D },
    ]);
  });

  it('ignores slots outside the period and beyond the period target', () => {
    const h = stickyHabit({
      perPeriod: 1,
      periods: [{ start: 0, end: 3 * D }],
      existingSlots: [
        { start: 4 * D + 13 * H, end: 4 * D + 14 * H }, // outside the period
        { start: 1 * D + 13 * H, end: 1 * D + 14 * H },
        { start: 2 * D + 13 * H, end: 2 * D + 14 * H }, // beyond target 1
      ],
    });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(spans(res)).toEqual([{ start: 1 * D + 13 * H, end: 1 * D + 14 * H }]);
  });

  it('skips a slot that falls outside the allowed windows', () => {
    const h = stickyHabit({
      perPeriod: 1,
      existingSlots: [{ start: 1 * D + 3 * H, end: 1 * D + 4 * H }], // 03:00, outside 09–17
    });
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(spans(res)).toEqual([{ start: 0 * D + 9 * H, end: 0 * D + 10 * H }]);
  });
});

describe('scheduleHabit pinnedSlotTimes', () => {
  const D = 86_400_000;
  const H = 3_600_000;

  const dayWindows = (days: number[], fromH = 9, toH = 17) =>
    days.map((d) => ({ start: d * D + fromH * H, end: d * D + toH * H }));

  it('consumes the day of a pinned occurrence without emitting it', () => {
    const h: Habit = {
      id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 2,
      periods: [{ start: 0, end: 7 * D }],
      allowedWindows: dayWindows([0, 1, 2]),
      pinnedSlotTimes: [1 * D + 13 * H],
    };
    const res = scheduleHabit([{ start: 0, end: 7 * D }], h, 0);
    expect(res.blocks.map((b) => Math.floor(b.start / D))).toEqual([0, 2]);
  });
});

describe('scheduleHabit with periodTargets (per-period counts)', () => {
  it("uses periodTargets[i] as each period's occurrence count", () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 3,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [1, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(1);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('places nothing in a period whose target is 0', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [0, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(0);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('falls back to perPeriod when periodTargets is absent (unchanged behavior)', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2, periods: [{ start: 0, end: 1000 }] }));
    expect(result.blocks).toHaveLength(2);
  });
});

describe('scheduleTask gapMs', () => {
  it('threads the gap so a task\'s own chunks are spaced', () => {
    const res = scheduleTask([{ start: 0, end: 100 }], { id: 't', title: 'T', priority: 1, durationMs: 40, dueBy: 100, minChunkMs: 20, maxChunkMs: 20 }, 10);
    expect(res.blocks.map((b) => [b.start, b.end])).toEqual([[0, 20], [30, 50]]);
  });
});

describe('scheduleHabit gapMs', () => {
  it('spaces two occurrences in the same period by the gap', () => {
    const res = scheduleHabit([{ start: 0, end: 100 }], { id: 'h', title: 'H', priority: 1, chunkMs: 20, perPeriod: 2, periods: [{ start: 0, end: 100 }] }, 10);
    expect(res.blocks.map((b) => [b.start, b.end])).toEqual([[0, 20], [30, 50]]);
  });
});

describe('scheduleTask allowedWindows', () => {
  const H = 3_600_000;
  const baseTask = { id: 't1', title: 'T', priority: 1, durationMs: H, dueBy: 10 * H, minChunkMs: H, maxChunkMs: H };

  it('confines placement to the allowed windows', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], { ...baseTask, allowedWindows: [{ start: 3 * H, end: 5 * H }] });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ start: 3 * H, end: 4 * H });
    expect(res.unscheduled).toHaveLength(0);
  });

  it('leaves the chunk unscheduled when it cannot fit the allowed windows', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], { ...baseTask, allowedWindows: [{ start: 3 * H, end: 3 * H + 30 * 60_000 }] });
    expect(res.blocks).toHaveLength(0);
    expect(res.unscheduled[0]).toMatchObject({ sourceId: 't1', remainingMs: H });
  });

  it('places at the earliest free slot when allowedWindows is omitted (regression)', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], baseTask);
    expect(res.blocks[0]).toMatchObject({ start: 0, end: H });
  });
});
