import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { computeDesiredSchedule } from '../src/compute.js';
import { fakeRepos, makeSettings, makeTask } from './fakes.js';

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
});
