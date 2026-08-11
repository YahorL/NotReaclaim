import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { scheduleHabit } from '@notreclaim/scheduler';
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

  it('attaches existingSlots when the caller supplies them', () => {
    const now = utc('2026-01-05T00:00:00');
    const slots = [{ start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T09:30:00') }];
    expect(expandHabit(dbHabit(), 'utc', now, 7, slots).existingSlots).toEqual(slots);
  });

  it('omits existingSlots when the caller supplies none or an empty list', () => {
    const now = utc('2026-01-05T00:00:00');
    expect(expandHabit(dbHabit(), 'utc', now, 7).existingSlots).toBeUndefined();
    expect(expandHabit(dbHabit(), 'utc', now, 7, []).existingSlots).toBeUndefined();
  });

  it('clips the final period to the horizon end', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday (ISO week start)
    const h = expandHabit(dbHabit(), 'utc', now, 10); // horizon end = Jan 15
    expect(h.periods).toHaveLength(2);
    expect(h.periods[h.periods.length - 1]!.end).toBe(utc('2026-01-15T00:00:00'));
  });
});

// The engine keys a capped habit occurrence by the START of the allowed-window day
// it consumed. That start must therefore be a stable wall-clock anchor (midnight),
// never `now` — otherwise today's key churns on every replan and the persisted row
// (plus its mirrored Google event) is deleted and recreated each time.
describe('expandHabit day anchoring (replan stability)', () => {
  it("anchors today's allowedWindows entry to midnight, not to `now`", () => {
    const morning = utc('2026-01-05T08:00:00'); // Monday
    const afternoon = utc('2026-01-05T14:30:00'); // same Monday, later
    const a = expandHabit(dbHabit(), 'utc', morning, 7);
    const b = expandHabit(dbHabit(), 'utc', afternoon, 7);

    expect(a.allowedWindows[0]!.start).toBe(utc('2026-01-05T00:00:00'));
    expect(a.allowedWindows.map((w) => w.start)).toEqual(b.allowedWindows.map((w) => w.start));
  });

  it('anchors preferredWindows to the wall clock even when the window already passed', () => {
    const afternoon = utc('2026-01-05T14:30:00');
    const h = expandHabit(
      dbHabit({ eligibleDays: [1], preferredStartMinute: 540, preferredEndMinute: 660 }),
      'utc', afternoon, 7,
    );
    expect(h.preferredWindows![0]).toEqual({
      start: utc('2026-01-05T09:00:00'),
      end: utc('2026-01-05T11:00:00'),
    });
  });

  it('keeps habit occurrence ids stable when only `now` advances', () => {
    const free = [{ start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T17:00:00') }];
    const habit = dbHabit({ eligibleDays: [1], perPeriod: 1 });
    const early = scheduleHabit(free, expandHabit(habit, 'utc', utc('2026-01-05T08:00:00'), 1));
    const late = scheduleHabit(free, expandHabit(habit, 'utc', utc('2026-01-05T08:30:00'), 1));

    expect(early.blocks).toHaveLength(1);
    expect(early.blocks.map((b) => b.id)).toEqual(late.blocks.map((b) => b.id));
    expect(early.blocks[0]!.id).toBe(`habit:h1:${utc('2026-01-05T00:00:00')}`);
  });
});
