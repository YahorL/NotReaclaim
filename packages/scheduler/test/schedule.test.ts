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
