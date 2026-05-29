import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Habit } from '@notreclaim/db';
import { expandHabit } from '../src/habit-expansion.js';
import { InvalidTimezoneError } from '../src/errors.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

const dbHabit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  userId: 'u1',
  title: 'Exercise',
  priority: 2,
  chunkMs: 1800000,
  perPeriod: 3,
  periodType: 'week',
  preferredStartMinute: null,
  preferredEndMinute: null,
  eligibleDays: [1, 3, 5],
  status: 'active',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe('expandHabit', () => {
  it('produces ISO Monday-week periods clipped to the horizon', () => {
    const now = utc('2026-01-07T00:00:00'); // Wednesday; ISO week starts Mon 2026-01-05
    const h = expandHabit(dbHabit(), 'utc', now, 10);
    expect(h.periods[0]!.start).toBe(now);
    expect(h.periods[0]!.end).toBe(utc('2026-01-12T00:00:00'));
    expect(h.periods[1]!.start).toBe(utc('2026-01-12T00:00:00'));
  });

  it('builds full-day allowedWindows only on eligible weekdays', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const h = expandHabit(dbHabit({ eligibleDays: [1] }), 'utc', now, 7); // Mondays only
    expect(h.allowedWindows).toEqual([
      { start: utc('2026-01-05T00:00:00'), end: utc('2026-01-06T00:00:00') },
    ]);
  });

  it('adds preferredWindows when a preferred time-of-day is set', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const h = expandHabit(
      dbHabit({ eligibleDays: [1], preferredStartMinute: 540, preferredEndMinute: 660 }),
      'utc', now, 7,
    );
    expect(h.preferredWindows).toEqual([
      { start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T11:00:00') },
    ]);
  });

  it('omits preferredWindows when no preferred time-of-day is set', () => {
    const now = utc('2026-01-05T00:00:00');
    const h = expandHabit(dbHabit({ eligibleDays: [1] }), 'utc', now, 7);
    expect(h.preferredWindows).toBeUndefined();
  });

  it('copies id, title, priority, chunkMs, perPeriod', () => {
    const now = utc('2026-01-05T00:00:00');
    const h = expandHabit(dbHabit(), 'utc', now, 7);
    expect(h).toMatchObject({ id: 'h1', title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3 });
  });

  it('throws InvalidTimezoneError for a bad zone', () => {
    expect(() => expandHabit(dbHabit(), 'Not/AZone', utc('2026-01-05T00:00:00'), 7))
      .toThrow(InvalidTimezoneError);
  });

  it('produces empty allowedWindows when eligibleDays is empty', () => {
    const now = utc('2026-01-05T00:00:00');
    const h = expandHabit(dbHabit({ eligibleDays: [] }), 'utc', now, 7);
    expect(h.allowedWindows).toEqual([]);
  });

  it('clips the final period to the horizon end', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday (ISO week start)
    const h = expandHabit(dbHabit(), 'utc', now, 10); // horizon end = Jan 15
    expect(h.periods).toHaveLength(2);
    expect(h.periods[h.periods.length - 1]!.end).toBe(utc('2026-01-15T00:00:00'));
  });
});
