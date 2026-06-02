import type { WorkingHour } from '../../api/types';
import type { DayState } from './settingsForm';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function windowsToDays(windows: WorkingHour[] | null): DayState[] {
  return WEEKDAYS.map((weekday) => {
    const wh = (windows ?? []).find((w) => w.weekday === weekday);
    return wh
      ? { weekday, enabled: true, start: minutesToHHMM(wh.startMinute), end: minutesToHHMM(wh.endMinute) }
      : { weekday, enabled: false, start: '09:00', end: '17:00' };
  });
}

export function daysToWindows(days: DayState[]): WorkingHour[] {
  return days
    .filter((d) => d.enabled)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) }));
}

export function validateCategoryForm(name: string, days: DayState[]): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: 'Name is required' };
  const enabled = days.filter((d) => d.enabled);
  if (enabled.length === 0) return { ok: false, error: 'Enable at least one day' };
  if (enabled.some((d) => hhmmToMinutes(d.start) >= hhmmToMinutes(d.end))) return { ok: false, error: 'End must be after start' };
  return { ok: true };
}
