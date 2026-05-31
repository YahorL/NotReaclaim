import { describe, it, expect } from 'vitest';
import {
  msToHM, hmToMs, minutesToHHMM, hhmmToMinutes,
  isoToLocalInput, localInputToIso, formatDurationShort,
} from './duration';

describe('duration', () => {
  it('msToHM / hmToMs round-trip', () => {
    expect(msToHM(5_400_000)).toEqual({ hours: 1, minutes: 30 });
    expect(msToHM(1_800_000)).toEqual({ hours: 0, minutes: 30 });
    expect(hmToMs(1, 30)).toBe(5_400_000);
    expect(hmToMs(0, 30)).toBe(1_800_000);
  });
  it('minutesToHHMM / hhmmToMinutes round-trip', () => {
    expect(minutesToHHMM(360)).toBe('06:00');
    expect(minutesToHHMM(545)).toBe('09:05');
    expect(hhmmToMinutes('06:00')).toBe(360);
    expect(hhmmToMinutes('09:05')).toBe(545);
  });
  it('isoToLocalInput / localInputToIso round-trip (TZ=UTC)', () => {
    expect(isoToLocalInput('2026-06-01T17:00:00.000Z')).toBe('2026-06-01T17:00');
    expect(localInputToIso('2026-06-01T17:00')).toBe('2026-06-01T17:00:00.000Z');
  });
  it('formatDurationShort', () => {
    expect(formatDurationShort(3_600_000)).toBe('1h');
    expect(formatDurationShort(5_400_000)).toBe('1h 30m');
    expect(formatDurationShort(1_800_000)).toBe('30m');
  });
});
