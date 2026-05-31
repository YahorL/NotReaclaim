import { describe, it, expect } from 'vitest';
import type { Settings } from '../../api/types';
import {
  toFormState, defaultFormState, validateSettingsForm, toSettingsInput, type SettingsFormState,
} from './settingsForm';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<SettingsFormState> = {}): SettingsFormState => ({
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000, ...over,
});

describe('settingsForm', () => {
  it('toFormState maps workingHours → per-day windows, off days disabled', () => {
    const s = toFormState(settings());
    expect(s.timezone).toBe('America/New_York');
    expect(s.horizonDays).toBe(7);
    expect(s.days).toHaveLength(7);
    expect(s.days.find((d) => d.weekday === 1)!).toEqual({ weekday: 1, enabled: true, start: '09:00', end: '17:00' });
    expect(s.days.find((d) => d.weekday === 0)!).toEqual({ weekday: 0, enabled: false, start: '09:00', end: '17:00' });
  });

  it('defaultFormState enables Mon–Fri with sensible defaults', () => {
    const s = defaultFormState('UTC');
    expect(s.timezone).toBe('UTC');
    expect(s.horizonDays).toBe(14);
    expect(s.defaultMinChunkMs).toBe(1_800_000);
    expect(s.defaultMaxChunkMs).toBe(7_200_000);
    expect(s.days.filter((d) => d.enabled).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('validateSettingsForm flags empties, horizon, min>max, and per-enabled-day end<=start', () => {
    expect(validateSettingsForm(validState()).ok).toBe(true);
    expect(validateSettingsForm(validState({ timezone: ' ' })).errors.timezone).toBeTruthy();
    expect(validateSettingsForm(validState({ horizonDays: 0 })).errors.horizonDays).toBeTruthy();
    expect(validateSettingsForm(validState({ horizonDays: 1.5 })).errors.horizonDays).toBeTruthy();
    expect(validateSettingsForm(validState({ defaultMinChunkMs: 8_000_000 })).errors.defaultMaxChunkMs).toBeTruthy();
    const badDay = validState();
    badDay.days = badDay.days.map((d) => (d.weekday === 1 ? { ...d, end: '08:00' } : d));
    expect(validateSettingsForm(badDay).errors.days?.[1]).toBeTruthy();
    const offBad = validState();
    offBad.days = offBad.days.map((d) => (d.weekday === 0 ? { ...d, enabled: false, end: '00:00' } : d));
    expect(validateSettingsForm(offBad).ok).toBe(true);
  });

  it('toSettingsInput omits off days, sorts, converts to minutes', () => {
    const input = toSettingsInput(validState());
    expect(input.workingHours).toHaveLength(5);
    expect(input.workingHours[0]).toEqual({ weekday: 1, startMinute: 540, endMinute: 1020 });
    expect(input.workingHours.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(input.timezone).toBe('UTC');
    expect(input.horizonDays).toBe(14);
    expect(input.defaultMinChunkMs).toBe(1_800_000);
  });
});
