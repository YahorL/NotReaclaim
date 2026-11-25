import type { WorkingHour } from '../../api/types';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

/** One weekday row of a weekly-hours editor. */
export interface DayState {
  weekday: number;   // 0=Sun .. 6=Sat
  enabled: boolean;
  start: string;     // "HH:MM"
  end: string;       // "HH:MM"
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Stored windows → seven editor rows (0..6). Days without a window are off, prefilled 09:00–17:00. */
export function windowsToDays(windows: WorkingHour[] | null): DayState[] {
  return WEEKDAYS.map((weekday) => {
    const wh = (windows ?? []).find((w) => w.weekday === weekday);
    return wh
      ? { weekday, enabled: true, start: minutesToHHMM(wh.startMinute), end: minutesToHHMM(wh.endMinute) }
      : { weekday, enabled: false, start: '09:00', end: '17:00' };
  });
}

/** Editor rows → stored windows: enabled days only, sorted by weekday. */
export function daysToWindows(days: DayState[]): WorkingHour[] {
  return days
    .filter((d) => d.enabled)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) }));
}

/** Copy of `days` with `patch` merged into the row for `weekday`. */
export function patchDay(days: DayState[], weekday: number, patch: Partial<DayState>): DayState[] {
  return days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d));
}

const MIN_PER_DAY = 24 * 60;

/** Total hours across the windows; an inverted or empty window counts 0, `null` (inherit) is 0. */
export function weeklyHoursTotal(windows: WorkingHour[] | null): number {
  const minutes = (windows ?? []).reduce((a, w) => a + Math.max(0, w.endMinute - w.startMinute), 0);
  return minutes / 60;
}

/** "35h per week" / "37.5h per week" (one decimal at most). */
export function weeklyHoursLabel(hours: number): string {
  return `${Math.round(hours * 10) / 10}h per week`;
}

/** Where a start–end window sits on a 24-hour bar, in percent; zero width when end ≤ start. */
export function coverage(start: string, end: string): { leftPct: number; widthPct: number } {
  const a = start ? hhmmToMinutes(start) : 0;
  const b = end ? hhmmToMinutes(end) : 0;
  return { leftPct: (a / MIN_PER_DAY) * 100, widthPct: (Math.max(0, b - a) / MIN_PER_DAY) * 100 };
}
