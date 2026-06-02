import type { Settings, SettingsInput } from '../../api/types';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

export interface DayState {
  weekday: number;   // 0=Sun .. 6=Sat
  enabled: boolean;
  start: string;     // "HH:MM"
  end: string;       // "HH:MM"
}

export interface SettingsFormState {
  timezone: string;
  days: DayState[];           // length 7, ordered by weekday 0..6
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  meetingBufferMs: number;
  taskBufferMs: number;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function toFormState(s: Settings): SettingsFormState {
  const days: DayState[] = WEEKDAYS.map((weekday) => {
    const wh = s.workingHours.find((w) => w.weekday === weekday);
    return wh
      ? { weekday, enabled: true, start: minutesToHHMM(wh.startMinute), end: minutesToHHMM(wh.endMinute) }
      : { weekday, enabled: false, start: '09:00', end: '17:00' };
  });
  return {
    timezone: s.timezone,
    days,
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
    meetingBufferMs: s.meetingBufferMs ?? 0,
    taskBufferMs: s.taskBufferMs ?? 0,
  };
}

export function defaultFormState(timezone: string): SettingsFormState {
  return {
    timezone,
    days: WEEKDAYS.map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
    horizonDays: 14,
    defaultMinChunkMs: 30 * 60_000,
    defaultMaxChunkMs: 120 * 60_000,
    meetingBufferMs: 0,
    taskBufferMs: 0,
  };
}

export interface SettingsFormErrors {
  timezone?: string;
  horizonDays?: string;
  defaultMinChunkMs?: string;
  defaultMaxChunkMs?: string;
  meetingBufferMs?: string;
  taskBufferMs?: string;
  days?: Partial<Record<number, string>>;
}

export function validateSettingsForm(s: SettingsFormState): { ok: boolean; errors: SettingsFormErrors } {
  const errors: SettingsFormErrors = {};
  if (!s.timezone.trim()) errors.timezone = 'Timezone is required';
  if (!Number.isInteger(s.horizonDays) || s.horizonDays <= 0) errors.horizonDays = 'Horizon must be a positive whole number of days';
  if (!(s.defaultMinChunkMs > 0)) errors.defaultMinChunkMs = 'Min chunk must be positive';
  if (!(s.defaultMaxChunkMs > 0)) errors.defaultMaxChunkMs = 'Max chunk must be positive';
  else if (s.defaultMinChunkMs > s.defaultMaxChunkMs) errors.defaultMaxChunkMs = 'Max chunk must be ≥ min chunk';

  if (!Number.isInteger(s.meetingBufferMs) || s.meetingBufferMs < 0) errors.meetingBufferMs = 'Buffer must be a whole number of minutes (≥ 0)';
  if (!Number.isInteger(s.taskBufferMs) || s.taskBufferMs < 0) errors.taskBufferMs = 'Buffer must be a whole number of minutes (≥ 0)';

  const days: Partial<Record<number, string>> = {};
  for (const d of s.days) {
    if (d.enabled && hhmmToMinutes(d.start) >= hhmmToMinutes(d.end)) days[d.weekday] = 'End must be after start';
  }
  if (Object.keys(days).length > 0) errors.days = days;

  return { ok: Object.keys(errors).length === 0, errors };
}

export function toSettingsInput(s: SettingsFormState): SettingsInput {
  const workingHours = s.days
    .filter((d) => d.enabled)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) }));
  return {
    timezone: s.timezone,
    workingHours,
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
    meetingBufferMs: s.meetingBufferMs,
    taskBufferMs: s.taskBufferMs,
  };
}

/** Valid IANA zones for the picker. Degrades to [] where Intl.supportedValuesOf is unavailable
 *  (the form prepends the current zone, so the select is always usable). */
export function supportedTimezones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [];
}
