import { hhmmToMinutes } from '../lib/duration';
import type { DayState } from './weeklyHours';

export { windowsToDays, daysToWindows } from './weeklyHours';

export function validateCategoryForm(name: string, days: DayState[]): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: 'Name is required' };
  const enabled = days.filter((d) => d.enabled);
  if (enabled.length === 0) return { ok: false, error: 'Enable at least one day' };
  // A cleared <input type="time"> reads '', which hhmmToMinutes turns into 00:00 — check first.
  if (enabled.some((d) => !d.start || !d.end)) return { ok: false, error: 'Enter a start and end time' };
  if (enabled.some((d) => hhmmToMinutes(d.start) >= hhmmToMinutes(d.end))) return { ok: false, error: 'End must be after start' };
  return { ok: true };
}
