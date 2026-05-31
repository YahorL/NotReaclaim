import { describe, it, expect } from 'vitest';
import type { Habit } from '../../api/types';
import { defaultQuickAddInput, toFormState, validateHabitForm, toUpdateInput, type HabitFormState } from './habitForm';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: 360, preferredEndMinute: 540, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<HabitFormState> = {}): HabitFormState => ({
  title: 'Run', chunkMs: 1_800_000, perPeriod: 4, priority: 3, eligibleDays: [1, 3, 5],
  preferredStart: '06:00', preferredEnd: '09:00', status: 'active', ...over,
});

describe('habitForm', () => {
  it('defaultQuickAddInput uses smart defaults (all 7 days, null window)', () => {
    expect(defaultQuickAddInput('  Meditate  ')).toEqual({
      title: 'Meditate', priority: 3, chunkMs: 1_800_000, perPeriod: 3,
      eligibleDays: [0, 1, 2, 3, 4, 5, 6], preferredStartMinute: null, preferredEndMinute: null,
    });
  });

  it('toFormState maps minutes → "HH:MM" and null window → ""', () => {
    expect(toFormState(habit())).toEqual({
      title: 'Run', chunkMs: 1_800_000, perPeriod: 4, priority: 2, eligibleDays: [1, 3, 5],
      preferredStart: '06:00', preferredEnd: '09:00', status: 'active',
    });
    const s = toFormState(habit({ preferredStartMinute: null, preferredEndMinute: null }));
    expect(s.preferredStart).toBe('');
    expect(s.preferredEnd).toBe('');
  });

  it('validateHabitForm flags empty title, non-positive chunk/perPeriod, zero days, start>=end', () => {
    expect(validateHabitForm(validState()).ok).toBe(true);
    expect(validateHabitForm(validState({ title: ' ' })).errors.title).toBeTruthy();
    expect(validateHabitForm(validState({ chunkMs: 0 })).errors.chunkMs).toBeTruthy();
    expect(validateHabitForm(validState({ perPeriod: 0 })).errors.perPeriod).toBeTruthy();
    expect(validateHabitForm(validState({ eligibleDays: [] })).errors.eligibleDays).toBeTruthy();
    expect(validateHabitForm(validState({ preferredStart: '10:00', preferredEnd: '09:00' })).errors.preferredEnd).toBeTruthy();
  });

  it('toUpdateInput converts "HH:MM" → minutes (or null) and includes status', () => {
    expect(toUpdateInput(validState({ preferredStart: '', preferredEnd: '', status: 'paused' }))).toEqual({
      title: 'Run', priority: 3, chunkMs: 1_800_000, perPeriod: 4, eligibleDays: [1, 3, 5],
      preferredStartMinute: null, preferredEndMinute: null, status: 'paused',
    });
  });
});
