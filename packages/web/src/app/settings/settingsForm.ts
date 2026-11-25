import type { Settings, SettingsInput } from '../../api/types';
import { hhmmToMinutes } from '../lib/duration';
import { type DayState, WEEKDAYS, windowsToDays, daysToWindows } from './weeklyHours';

export interface SettingsFormState {
  timezone: string;
  days: DayState[];           // length 7, ordered by weekday 0..6
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  meetingBufferMs: number;
  taskBufferMs: number;
  requireStartToTrack: boolean;
  /** Visual planner day boundary, minutes past local midnight. Optional so callers built before
   *  Review 20 (and their fixtures) stay valid; treated as 0 when absent. */
  dayStartMinute?: number;
}

export function toFormState(s: Settings): SettingsFormState {
  return {
    timezone: s.timezone,
    days: windowsToDays(s.workingHours),
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
    meetingBufferMs: s.meetingBufferMs ?? 0,
    taskBufferMs: s.taskBufferMs ?? 0,
    requireStartToTrack: s.requireStartToTrack ?? false,
    dayStartMinute: s.dayStartMinute ?? 0,
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
    requireStartToTrack: false,
    dayStartMinute: 0,
  };
}

export interface SettingsFormErrors {
  timezone?: string;
  horizonDays?: string;
  defaultMinChunkMs?: string;
  defaultMaxChunkMs?: string;
  meetingBufferMs?: string;
  taskBufferMs?: string;
  dayStartMinute?: string;
  days?: Partial<Record<number, string>>;
}

/** Buffers are 0..24 h — the server's bound too. */
export const MAX_BUFFER_MINUTES = 24 * 60;
const BUFFER_NOT_WHOLE = 'Buffer must be a whole number of minutes (≥ 0)';
const BUFFER_TOO_LONG = 'Buffer must be at most 24 hours (1440 min)';

/**
 * The rule for `meetingBufferMs` / `taskBufferMs` as stored (ms), used by the Settings form.
 * No 24 h cap here: that form has no buffer fields to show it on, so a larger value stored
 * before the server capped it would silently disable Save. Its save leaves the buffers out
 * (useSaveSettingsMutation), so such a value no longer reaches the server from there either.
 */
export function validateBufferMs(ms: number): string | undefined {
  if (!Number.isInteger(ms) || ms < 0) return BUFFER_NOT_WHOLE;
  return undefined;
}

/** The Buffers page's rule for a minute count as typed: digits only (so '', '-', '-5' and '1.5'
 *  are errors) and at most 24 h, matching the server. */
export function validateBufferMinutesText(text: string): string | undefined {
  if (!/^\d+$/.test(text)) return BUFFER_NOT_WHOLE;
  if (Number(text) > MAX_BUFFER_MINUTES) return BUFFER_TOO_LONG;
  return undefined;
}

export function validateSettingsForm(s: SettingsFormState): { ok: boolean; errors: SettingsFormErrors } {
  const errors: SettingsFormErrors = {};
  if (!s.timezone.trim()) errors.timezone = 'Timezone is required';
  if (!Number.isInteger(s.horizonDays) || s.horizonDays <= 0) errors.horizonDays = 'Horizon must be a positive whole number of days';
  if (!(s.defaultMinChunkMs > 0)) errors.defaultMinChunkMs = 'Min chunk must be positive';
  if (!(s.defaultMaxChunkMs > 0)) errors.defaultMaxChunkMs = 'Max chunk must be positive';
  else if (s.defaultMinChunkMs > s.defaultMaxChunkMs) errors.defaultMaxChunkMs = 'Max chunk must be ≥ min chunk';

  const meetingBufferError = validateBufferMs(s.meetingBufferMs);
  if (meetingBufferError) errors.meetingBufferMs = meetingBufferError;
  const taskBufferError = validateBufferMs(s.taskBufferMs);
  if (taskBufferError) errors.taskBufferMs = taskBufferError;

  const dayStart = s.dayStartMinute ?? 0;
  if (!Number.isInteger(dayStart) || dayStart < 0 || dayStart > 1439) errors.dayStartMinute = 'Day start must be a time of day';

  const days: Partial<Record<number, string>> = {};
  for (const d of s.days) {
    // A cleared <input type="time"> reads '', which hhmmToMinutes turns into 00:00 — check first.
    if (d.enabled && (!d.start || !d.end)) days[d.weekday] = 'Enter a start and end time';
    else if (d.enabled && hhmmToMinutes(d.start) >= hhmmToMinutes(d.end)) days[d.weekday] = 'End must be after start';
  }
  if (Object.keys(days).length > 0) errors.days = days;

  return { ok: Object.keys(errors).length === 0, errors };
}

export function toSettingsInput(s: SettingsFormState): SettingsInput {
  return {
    timezone: s.timezone,
    workingHours: daysToWindows(s.days),
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
    meetingBufferMs: s.meetingBufferMs,
    taskBufferMs: s.taskBufferMs,
    requireStartToTrack: s.requireStartToTrack,
    dayStartMinute: s.dayStartMinute ?? 0,
  };
}

/** Valid IANA zones for the picker. Degrades to [] where Intl.supportedValuesOf is unavailable
 *  (the form prepends the current zone, so the select is always usable). */
export function supportedTimezones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [];
}

/** Returns the browser's detected IANA timezone, or 'UTC' if it cannot be determined. */
export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
