import type { Habit } from '../../api/types';
import { WEEKDAY_SHORT } from '../lib/weekdays';

const HOUR_MS = 3_600_000;

/** The Habits summary strip: active / hours booked per week (Σ chunk × times-per-week, active only) / paused. */
export function habitSummary(habits: Habit[]): { active: number; paused: number; weeklyMs: number; weeklyLabel: string } {
  const active = habits.filter((h) => h.status === 'active');
  const weeklyMs = active.reduce((a, h) => a + h.chunkMs * h.perPeriod, 0);
  return {
    active: active.length,
    paused: habits.length - active.length,
    weeklyMs,
    weeklyLabel: `${Math.round((weeklyMs / HOUR_MS) * 10) / 10}h`,
  };
}

/** "Mon Wed Fri" in weekday order, "any day" when every day is eligible. */
export function daysText(eligibleDays: number[]): string {
  if (eligibleDays.length === 0) return 'no days';
  if (new Set(eligibleDays).size >= 7) return 'any day';
  return [...eligibleDays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(' ');
}
