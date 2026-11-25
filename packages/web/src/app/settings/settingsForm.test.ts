import { describe, it, expect } from 'vitest';
import type { Settings } from '../../api/types';
import {
  toFormState, defaultFormState, validateSettingsForm, toSettingsInput, browserTimezone, type SettingsFormState,
  validateBufferMs, validateBufferMinutesText,
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
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, ...over,
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

  it('a cleared start or end time on an enabled day is an error, never a silent 00:00', () => {
    const s = validState();
    const days = s.days.map((d) => (d.weekday === 1 ? { ...d, enabled: true, start: '' } : d));
    expect(validateSettingsForm({ ...s, days }).errors.days?.[1]).toBe('Enter a start and end time');
    const noEnd = s.days.map((d) => (d.weekday === 1 ? { ...d, enabled: true, end: '' } : d));
    expect(validateSettingsForm({ ...s, days: noEnd }).ok).toBe(false);
  });

  it('a cleared day start (NaN) is an error, never midnight', () => {
    expect(validateSettingsForm(validState({ dayStartMinute: Number.NaN })).errors.dayStartMinute).toBeDefined();
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

  it('round-trips buffer fields and rejects a negative buffer', () => {
    const base = defaultFormState('UTC');
    expect(base.meetingBufferMs).toBe(0);
    expect(base.taskBufferMs).toBe(0);
    const out = toSettingsInput({ ...base, meetingBufferMs: 900000, taskBufferMs: 600000 });
    expect(out).toMatchObject({ meetingBufferMs: 900000, taskBufferMs: 600000 });
    expect(validateSettingsForm({ ...base, meetingBufferMs: -60000 }).ok).toBe(false);
  });

  // The Settings form shows no buffer fields, so a buffer over 24 h stored before the server
  // capped it must not silently disable its Save: the server's 400 names the field instead.
  it('does not cap a stored buffer in the Settings form, which has no field to show the error', () => {
    expect(validateBufferMs(0)).toBeUndefined();
    expect(validateBufferMs(25 * 60 * 60_000)).toBeUndefined();
    expect(validateSettingsForm(validState({ meetingBufferMs: 25 * 60 * 60_000 })).ok).toBe(true);
    expect(validateBufferMs(-60_000)).toBe('Buffer must be a whole number of minutes (≥ 0)');
  });

  it('validates typed buffer text: whole minutes 0..1440, nothing else', () => {
    for (const ok of ['0', '5', '05', '1440']) expect(validateBufferMinutesText(ok), ok).toBeUndefined();
    for (const bad of ['', ' ', '-', '-5', '1.5', '1e3', 'abc']) {
      expect(validateBufferMinutesText(bad), bad).toBe('Buffer must be a whole number of minutes (≥ 0)');
    }
    expect(validateBufferMinutesText('1441')).toBe('Buffer must be at most 24 hours (1440 min)');
  });

  it('round-trips dayStartMinute and defaults it to 0', () => {
    expect(defaultFormState('UTC').dayStartMinute).toBe(0);
    expect(toFormState(settings()).dayStartMinute).toBe(0);                       // absent on the server row
    expect(toFormState(settings({ dayStartMinute: 180 })).dayStartMinute).toBe(180);
    expect(toSettingsInput(validState()).dayStartMinute).toBe(0);
    expect(toSettingsInput(validState({ dayStartMinute: 180 })).dayStartMinute).toBe(180);
  });

  it('validateSettingsForm rejects a dayStartMinute outside 0–1439 or non-integer', () => {
    expect(validateSettingsForm(validState({ dayStartMinute: 0 })).ok).toBe(true);
    expect(validateSettingsForm(validState({ dayStartMinute: 1439 })).ok).toBe(true);
    expect(validateSettingsForm(validState({ dayStartMinute: 1440 })).errors.dayStartMinute).toBeTruthy();
    expect(validateSettingsForm(validState({ dayStartMinute: -1 })).errors.dayStartMinute).toBeTruthy();
    expect(validateSettingsForm(validState({ dayStartMinute: 12.5 })).errors.dayStartMinute).toBeTruthy();
  });

  it('browserTimezone() returns a non-empty string and defaultFormState uses it as the default', () => {
    const tz = browserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    // The Settings page default path: defaultFormState(browserTimezone())
    // Under TZ=UTC the browser zone resolves to 'UTC'
    expect(defaultFormState(tz).timezone).toBe(tz);
    // browserTimezone() must match what Intl reports (or 'UTC' on failure)
    const intlZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect(tz).toBe(intlZone);
  });
});
