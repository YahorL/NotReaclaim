import { describe, it, expect } from 'vitest';
import {
  msToHM, minutesToHHMM, hhmmToMinutes,
  formatDurationShort, untilLabel,
} from './duration';

describe('duration', () => {
  it('msToHM splits ms into hours and minutes', () => {
    expect(msToHM(5_400_000)).toEqual({ hours: 1, minutes: 30 });
    expect(msToHM(1_800_000)).toEqual({ hours: 0, minutes: 30 });
  });
  it('minutesToHHMM / hhmmToMinutes round-trip', () => {
    expect(minutesToHHMM(360)).toBe('06:00');
    expect(minutesToHHMM(545)).toBe('09:05');
    expect(hhmmToMinutes('06:00')).toBe(360);
    expect(hhmmToMinutes('09:05')).toBe(545);
  });
  it('formatDurationShort', () => {
    expect(formatDurationShort(3_600_000)).toBe('1h');
    expect(formatDurationShort(5_400_000)).toBe('1h 30m');
    expect(formatDurationShort(1_800_000)).toBe('30m');
  });

  it('untilLabel: a compact "in …" for the Next-up chip', () => {
    const now = Date.parse('2026-01-05T12:00:00.000Z');
    const at = (min: number) => now + min * 60_000;
    expect(untilLabel(at(0), now)).toBe('now');
    expect(untilLabel(at(-5), now)).toBe('now');
    expect(untilLabel(at(0.5), now)).toBe('in 1m'); // rounds up: never "in 0m"
    expect(untilLabel(at(5), now)).toBe('in 5m');
    expect(untilLabel(at(60), now)).toBe('in 1h');
    expect(untilLabel(at(89), now)).toBe('in 1h 29m');
    expect(untilLabel(at(23 * 60 + 59), now)).toBe('in 23h 59m');
    expect(untilLabel(at(24 * 60), now)).toBe('in 1d');
    expect(untilLabel(at(3 * 24 * 60 + 600), now)).toBe('in 3d');
  });
});
