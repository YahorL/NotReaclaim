import type { Habit, HabitStatus, CreateHabitInput, UpdateHabitInput } from '../../api/types';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

export interface HabitFormState {
  title: string;
  chunkMs: number;
  perPeriod: number;
  priority: number;
  eligibleDays: number[];   // 0..6
  preferredStart: string;   // "HH:MM" or ''
  preferredEnd: string;     // "HH:MM" or ''
  status: HabitStatus;
}

export function defaultQuickAddInput(title: string): CreateHabitInput {
  return {
    title: title.trim(),
    priority: 3,
    chunkMs: 30 * 60_000,
    perPeriod: 3,
    eligibleDays: [0, 1, 2, 3, 4, 5, 6],
    preferredStartMinute: null,
    preferredEndMinute: null,
  };
}

export function toFormState(h: Habit): HabitFormState {
  return {
    title: h.title,
    chunkMs: h.chunkMs,
    perPeriod: h.perPeriod,
    priority: h.priority,
    eligibleDays: [...h.eligibleDays],
    preferredStart: h.preferredStartMinute != null ? minutesToHHMM(h.preferredStartMinute) : '',
    preferredEnd: h.preferredEndMinute != null ? minutesToHHMM(h.preferredEndMinute) : '',
    status: h.status,
  };
}

export type HabitFormErrors = Partial<Record<keyof HabitFormState, string>>;

export function validateHabitForm(s: HabitFormState): { ok: boolean; errors: HabitFormErrors } {
  const errors: HabitFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.chunkMs > 0)) errors.chunkMs = 'Chunk must be positive';
  if (!(s.perPeriod > 0)) errors.perPeriod = 'Times per week must be positive';
  if (s.eligibleDays.length === 0) errors.eligibleDays = 'Pick at least one day';
  if (s.preferredStart && s.preferredEnd && hhmmToMinutes(s.preferredStart) >= hhmmToMinutes(s.preferredEnd)) {
    errors.preferredEnd = 'End must be after start';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toUpdateInput(s: HabitFormState): UpdateHabitInput {
  return {
    title: s.title.trim(),
    priority: s.priority,
    chunkMs: s.chunkMs,
    perPeriod: s.perPeriod,
    eligibleDays: s.eligibleDays,
    preferredStartMinute: s.preferredStart ? hhmmToMinutes(s.preferredStart) : null,
    preferredEndMinute: s.preferredEnd ? hhmmToMinutes(s.preferredEnd) : null,
    status: s.status,
  };
}
