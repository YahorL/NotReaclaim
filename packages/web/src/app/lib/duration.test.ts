import { describe, it, expect } from 'vitest';
import {
  msToHM, minutesToHHMM, hhmmToMinutes,
  formatDurationShort,
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
});
