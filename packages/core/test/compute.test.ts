import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { computeDesiredSchedule } from '../src/compute.js';
import { fakeRepos, makeSettings, makeTask, makeHabit, makeBlock, makeEvent } from './fakes.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('computeDesiredSchedule', () => {
  it('computes desired blocks from repository data', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 1,
          workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({
          id: 't1', status: 'pending', priority: 1,
          durationMs: 3600000, dueBy: new Date(utc('2026-01-05T17:00:00')),
          minChunkMs: 1800000, maxChunkMs: 1800000,
        })],
      }),
      'u1', now,
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.sourceId).toBe('t1');
    expect(result.unscheduled).toHaveLength(0);
  });

  it('surfaces an over-deadline task as unscheduled', async () => {
    const now = utc('2026-01-05T00:00:00');
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 1,
          workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({
          id: 't1', status: 'pending', priority: 1,
          durationMs: 36000000, dueBy: new Date(utc('2026-01-05T10:00:00')),
          minChunkMs: 3600000, maxChunkMs: 3600000,
        })],
      }),
      'u1', now,
    );
    expect(result.unscheduled.length).toBeGreaterThan(0);
  });

  it('places a habit only on its eligible days (end-to-end)', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const wh = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 7,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        habits: [makeHabit({
          id: 'h1', status: 'active', eligibleDays: [1], perPeriod: 1,
          chunkMs: 1800000, preferredStartMinute: null, preferredEndMinute: null,
        })],
      }),
      'u1', now,
    );
    const habitBlocks = result.blocks.filter((b) => b.sourceType === 'habit');
    expect(habitBlocks).toHaveLength(1);
    expect(DateTime.fromMillis(habitBlocks[0]!.start, { zone: 'utc' }).weekday).toBe(1); // Monday
  });

  it('does not place a task over a running habit occurrence', async () => {
    const now = utc('2026-01-05T12:00:00'); // Monday noon, mid-occurrence
    const wh = [{ weekday: 1, startMinute: 0, endMinute: 1440 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 1,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        habits: [makeHabit({ id: 'h1', status: 'active', eligibleDays: [1], perPeriod: 1, chunkMs: 1800000 })],
        tasks: [makeTask({
          id: 't1', status: 'pending', priority: 1,
          durationMs: 3600000, dueBy: new Date(utc('2026-01-05T23:00:00')),
          minChunkMs: 3600000, maxChunkMs: 3600000,
        })],
        blocks: [makeBlock({
          id: 'running', taskId: null, habitId: 'h1', pinned: false,
          startsAt: new Date(utc('2026-01-05T11:45:00')), endsAt: new Date(utc('2026-01-05T12:15:00')),
        })],
      }),
      'u1', now,
    );
    // The frozen occurrence is not re-emitted, and its last 15 minutes stay reserved.
    expect(result.blocks).toEqual([
      expect.objectContaining({ sourceId: 't1', start: utc('2026-01-05T12:15:00'), end: utc('2026-01-05T13:15:00') }),
    ]);
  });

  it('does not double-book a day after a pinned occurrence has ended', async () => {
    const now = utc('2026-01-05T12:00:00'); // Monday noon
    const wh = [{ weekday: 1, startMinute: 0, endMinute: 1440 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 1,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        habits: [makeHabit({ id: 'h1', status: 'active', eligibleDays: [1], perPeriod: 1, chunkMs: 1800000 })],
        blocks: [makeBlock({
          id: 'pinned-done', taskId: null, habitId: 'h1', pinned: true,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(result.blocks.filter((b) => b.sourceType === 'habit')).toEqual([]);
  });

  it('reports a habit with no eligible days as unscheduled', async () => {
    const now = utc('2026-01-05T00:00:00');
    const wh = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 7,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        habits: [makeHabit({ id: 'h1', status: 'active', eligibleDays: [], perPeriod: 1, chunkMs: 1800000 })],
      }),
      'u1', now,
    );
    expect(result.blocks.filter((b) => b.sourceType === 'habit')).toHaveLength(0);
    expect(result.unscheduled.some((u) => u.sourceId === 'h1')).toBe(true);
  });

  it('still reports a habit whose only eligible day has no free time', async () => {
    // Proration silences unreachable days; a reachable day with a full calendar must
    // keep warning, since that is something the user can act on.
    const now = utc('2026-01-05T00:00:00'); // Monday
    const wh = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 1,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        habits: [makeHabit({ id: 'h1', status: 'active', eligibleDays: [1], perPeriod: 1, chunkMs: 1800000 })],
        events: [makeEvent({
          id: 'busy-all-day',
          startsAt: new Date(utc('2026-01-05T00:00:00')),
          endsAt: new Date(utc('2026-01-06T00:00:00')),
        })],
      }),
      'u1', now,
    );
    expect(result.blocks.filter((b) => b.sourceType === 'habit')).toHaveLength(0);
    expect(result.unscheduled.some((u) => u.sourceId === 'h1')).toBe(true);
  });
});
