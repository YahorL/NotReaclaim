import { describe, it, expect } from 'vitest';
import type { Habit, Task, UnscheduledItem } from '../../api/types';
import { missedByHabit, summarizeUnscheduled } from './unscheduledSummary';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
  durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
  categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
  createdAt: '', updatedAt: '', ...over,
});

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '', updatedAt: '', ...over,
});

const item = (over: Partial<UnscheduledItem> = {}): UnscheduledItem => ({
  sourceType: 'task', sourceId: 't1', title: 'Write spec', reason: 'no free time', remainingMs: 3_600_000, ...over,
});

describe('missedByHabit', () => {
  it('divides remainingMs by the habit chunk to recover the occurrence count', () => {
    const items = [item({ sourceType: 'habit', sourceId: 'h1', title: 'Run', remainingMs: 5_400_000 })];
    expect(missedByHabit(items, [habit()]).get('h1')).toBe(3); // 90m / 30m
  });

  it('ignores task rows and unknown habits fall back to one occurrence', () => {
    const items = [item(), item({ sourceType: 'habit', sourceId: 'hX', title: 'Gone', remainingMs: 600_000 })];
    const map = missedByHabit(items, [habit()]);
    expect(map.has('t1')).toBe(false);
    expect(map.get('hX')).toBe(1);
  });

  it('is empty for undefined input', () => {
    expect(missedByHabit(undefined, undefined).size).toBe(0);
  });
});

describe('summarizeUnscheduled', () => {
  it('renders task remainders with the shared duration formatter', () => {
    const entries = summarizeUnscheduled([item({ remainingMs: 5_400_000 })], [task()], []);
    expect(entries.map((e) => e.label)).toEqual(['Write spec (1h 30m left)']);
  });

  it('sums repeated task rows into one entry', () => {
    const entries = summarizeUnscheduled(
      [item({ remainingMs: 1_800_000 }), item({ remainingMs: 1_800_000 })],
      [task()], [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('Write spec (1h left)');
  });

  it('renders habit rows as a missed-occurrence count', () => {
    const entries = summarizeUnscheduled(
      [item({ sourceType: 'habit', sourceId: 'h1', title: 'Run', remainingMs: 3_600_000 })],
      [], [habit()],
    );
    expect(entries.map((e) => e.label)).toEqual(['Run (2 missed)']);
  });

  it('prefers the live query title over the stale snapshot title', () => {
    const entries = summarizeUnscheduled([item({ title: 'Old title' })], [task({ title: 'Renamed' })], []);
    expect(entries[0]!.label).toBe('Renamed (1h left)');
  });

  it('falls back to (deleted) for an id no query can resolve', () => {
    const entries = summarizeUnscheduled([item({ sourceId: 'gone', title: '' })], [], []);
    expect(entries[0]!.label).toBe('(deleted) (1h left)');
  });

  it('omits habit entries until the habits query has loaded, so no "1 missed" flashes', () => {
    const items = [
      item({ sourceType: 'habit', sourceId: 'h1', title: 'Run', remainingMs: 3_600_000 }),
      item({ remainingMs: 3_600_000 }),
    ];
    expect(summarizeUnscheduled(items, [task()], undefined).map((e) => e.key)).toEqual(['task:t1']);
    expect(summarizeUnscheduled(items, [task()], [habit()]).map((e) => e.label))
      .toEqual(['Run (2 missed)', 'Write spec (1h left)']);
  });

  it('keeps first-seen order and returns [] for empty input', () => {
    const entries = summarizeUnscheduled(
      [
        item({ sourceType: 'habit', sourceId: 'h1', remainingMs: 1_800_000 }),
        item({ sourceId: 't1', remainingMs: 1_800_000 }),
      ],
      [task()], [habit()],
    );
    expect(entries.map((e) => e.key)).toEqual(['habit:h1', 'task:t1']);
    expect(summarizeUnscheduled(undefined, [], [])).toEqual([]);
  });
});
