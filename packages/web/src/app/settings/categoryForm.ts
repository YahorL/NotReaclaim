import { hhmmToMinutes } from '../lib/duration';
import type { DayState } from './weeklyHours';

export { windowsToDays, daysToWindows } from './weeklyHours';

export function validateCategoryForm(name: string, days: DayState[]): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: 'Name is required' };
  const enabled = days.filter((d) => d.enabled);
  if (enabled.length === 0) return { ok: false, error: 'Enable at least one day' };
  if (enabled.some((d) => hhmmToMinutes(d.start) >= hhmmToMinutes(d.end))) return { ok: false, error: 'End must be after start' };
  return { ok: true };
}
