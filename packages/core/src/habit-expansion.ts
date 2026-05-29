import { DateTime } from 'luxon';
import type { Habit as EngineHabit, Interval } from '@notreclaim/scheduler';
import type { Habit as DbHabit } from '@notreclaim/db';
import { InvalidHorizonError } from './errors.js';
import { assertValidZone } from './time-windows.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Expand a DB habit (recurrence rule) into the engine Habit over the horizon:
 * ISO Monday-week `periods`, hard `allowedWindows` on eligible days, and soft
 * `preferredWindows` when a preferred time-of-day is set.
 */
export function expandHabit(
  habit: DbHabit,
  timezone: string,
  now: number,
  horizonDays: number,
): EngineHabit {
  assertValidZone(timezone);
  if (horizonDays <= 0) throw new InvalidHorizonError(horizonDays);

  const horizonEnd = now + horizonDays * MS_PER_DAY;

  // ISO Monday-week periods, clipped to the horizon.
  const periods: Interval[] = [];
  let weekStart = DateTime.fromMillis(now, { zone: timezone }).startOf('week');
  while (weekStart.toMillis() < horizonEnd) {
    const weekEnd = weekStart.plus({ weeks: 1 });
    const start = Math.max(weekStart.toMillis(), now);
    const end = Math.min(weekEnd.toMillis(), horizonEnd);
    if (end > start) periods.push({ start, end });
    weekStart = weekEnd;
  }

  // Eligible-day allowed windows (hard) + optional preferred windows (soft).
  const eligible = new Set(habit.eligibleDays);
  const hasPreferred =
    habit.preferredStartMinute != null && habit.preferredEndMinute != null;
  const allowedWindows: Interval[] = [];
  const preferredWindows: Interval[] = [];

  let day = DateTime.fromMillis(now, { zone: timezone }).startOf('day');
  while (day.toMillis() < horizonEnd) {
    if (eligible.has(day.weekday % 7)) {
      const dayStart = Math.max(day.toMillis(), now);
      const dayEnd = Math.min(day.plus({ days: 1 }).toMillis(), horizonEnd);
      if (dayEnd > dayStart) allowedWindows.push({ start: dayStart, end: dayEnd });

      if (hasPreferred) {
        // Use wall-clock set (not plus) so DST transitions don't shift the hour.
        const startHour = Math.floor(habit.preferredStartMinute! / 60);
        const startMin = habit.preferredStartMinute! % 60;
        const endHour = Math.floor(habit.preferredEndMinute! / 60);
        const endMin = habit.preferredEndMinute! % 60;
        const ps = Math.max(
          day.set({ hour: startHour, minute: startMin, second: 0, millisecond: 0 }).toMillis(),
          now,
        );
        const pe = Math.min(
          day.set({ hour: endHour, minute: endMin, second: 0, millisecond: 0 }).toMillis(),
          horizonEnd,
        );
        if (pe > ps) preferredWindows.push({ start: ps, end: pe });
      }
    }
    day = day.plus({ days: 1 });
  }

  const result: EngineHabit = {
    id: habit.id,
    title: habit.title,
    priority: habit.priority,
    chunkMs: habit.chunkMs,
    perPeriod: habit.perPeriod,
    periods,
    allowedWindows,
  };
  if (preferredWindows.length > 0) {
    result.preferredWindows = preferredWindows;
  }
  return result;
}
