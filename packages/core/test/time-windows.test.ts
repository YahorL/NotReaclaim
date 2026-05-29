import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { expandWorkingWindows } from '../src/time-windows.js';
import { InvalidTimezoneError, InvalidHorizonError } from '../src/errors.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('expandWorkingWindows', () => {
  it('emits a window per matching weekday within the horizon', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const windows = expandWorkingWindows(
      [{ weekday: 1, startMinute: 540, endMinute: 1020 }], // Monday 09:00-17:00
      'utc', now, 7,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T17:00:00') },
    ]);
  });

  it('clips the first window to now', () => {
    const now = utc('2026-01-05T12:00:00'); // Monday noon
    const windows = expandWorkingWindows(
      [{ weekday: 1, startMinute: 540, endMinute: 1020 }], 'utc', now, 1,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-05T12:00:00'), end: utc('2026-01-05T17:00:00') },
    ]);
  });

  it('skips days whose weekday has no working-hours entry', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const windows = expandWorkingWindows(
      [{ weekday: 2, startMinute: 540, endMinute: 1020 }], // Tuesday only
      'utc', now, 3,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-06T09:00:00'), end: utc('2026-01-06T17:00:00') },
    ]);
  });

  it('tracks wall-clock across a DST spring-forward (window stays 09:00 local)', () => {
    const zone = 'America/New_York'; // 2026-03-08 springs forward 02:00 -> 03:00
    const now = DateTime.fromObject({ year: 2026, month: 3, day: 6 }, { zone }).toMillis();
    const wh = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    const windows = expandWorkingWindows(wh, zone, now, 5);
    for (const w of windows) {
      expect(DateTime.fromMillis(w.start, { zone }).hour).toBe(9);
      expect(DateTime.fromMillis(w.end, { zone }).hour).toBe(17);
    }
    const mar7 = windows.find((w) => DateTime.fromMillis(w.start, { zone }).day === 7)!;
    const mar8 = windows.find((w) => DateTime.fromMillis(w.start, { zone }).day === 8)!;
    expect(mar8.start - mar7.start).toBe(23 * 60 * 60 * 1000);
  });

  it('throws for an invalid timezone and a non-positive horizon', () => {
    const now = utc('2026-01-05T00:00:00');
    expect(() => expandWorkingWindows([], 'Not/AZone', now, 7)).toThrow(InvalidTimezoneError);
    expect(() => expandWorkingWindows([], 'utc', now, 0)).toThrow(InvalidHorizonError);
  });
});
