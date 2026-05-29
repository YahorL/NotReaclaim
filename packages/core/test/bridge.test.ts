import { describe, it, expect } from 'vitest';
import { toScheduledBlockInput } from '../src/bridge.js';

describe('toScheduledBlockInput', () => {
  it('maps a task block to taskId', () => {
    expect(
      toScheduledBlockInput({
        id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Focus', start: 1000, end: 2000,
      }),
    ).toEqual({
      taskId: 't1', habitId: null, title: 'Focus', startsAt: new Date(1000), endsAt: new Date(2000),
    });
  });

  it('maps a habit block to habitId', () => {
    const r = toScheduledBlockInput({
      id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Run', start: 0, end: 30,
    });
    expect(r.habitId).toBe('h1');
    expect(r.taskId).toBeNull();
  });
});
