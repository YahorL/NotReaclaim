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
