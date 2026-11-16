import { DateTime } from 'luxon';
import type { Interval } from '@notreclaim/scheduler';
import { InvalidHorizonError, InvalidTimezoneError } from './errors.js';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** End of the planning horizon: `horizonDays` whole days after `now` (epoch ms). */
export function horizonEndMs(now: number, horizonDays: number): number {
  return now + horizonDays * MS_PER_DAY;
}

/** Round an epoch-ms instant to the nearest 15 minutes. */
export function round15(ms: number): number {
  return Math.round(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

/** A working-hours entry. weekday: 0 = Sunday .. 6 = Saturday. */
export interface WorkingHourEntry {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * The instant (epoch ms) at `minute` minutes past midnight on `day`, in `day`'s zone.
 * Uses wall-clock set (not plus) so DST transitions don't shift the hour.
 */
export function atMinuteOfDay(day: DateTime, minute: number): number {
  return day
    .set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 })
    .toMillis();
}

/** Throw if the IANA timezone is invalid (clock-free check). */
export function assertValidZone(timezone: string): void {
  if (!DateTime.fromMillis(0, { zone: timezone }).isValid) {
    throw new InvalidTimezoneError(timezone);
  }
}

/**
 * Expand working-hours entries into concrete epoch-ms intervals over
 * [now, now + horizonDays days], computed per calendar day in `timezone`
 * (DST-correct via luxon). Intervals are clipped to the horizon and sorted.
 */
export function expandWorkingWindows(
  workingHours: WorkingHourEntry[],
  timezone: string,
  now: number,
  horizonDays: number,
): Interval[] {
  assertValidZone(timezone);
  if (horizonDays <= 0) throw new InvalidHorizonError(horizonDays);

  const horizonEnd = horizonEndMs(now, horizonDays);
  const windows: Interval[] = [];
  let day = DateTime.fromMillis(now, { zone: timezone }).startOf('day');

  while (day.toMillis() < horizonEnd) {
    const weekday = day.weekday % 7; // luxon Mon=1..Sun=7 -> Sun=0..Sat=6
    for (const wh of workingHours) {
      if (wh.weekday !== weekday) continue;
      const start = Math.max(atMinuteOfDay(day, wh.startMinute), now);
      const end = Math.min(atMinuteOfDay(day, wh.endMinute), horizonEnd);
      if (end > start) windows.push({ start, end });
    }
    day = day.plus({ days: 1 });
  }

  windows.sort((a, b) => a.start - b.start);
  return windows;
}
