import { describe, it, expect } from 'vitest';
import { weeklyHoursTotal, weeklyHoursLabel, coverage, windowsToDays, daysToWindows } from './weeklyHours';

describe('weeklyHoursTotal', () => {
  it('sums every window in hours', () => {
    const mf = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 600, endMinute: 1020 })); // 10:00–17:00
    expect(weeklyHoursTotal(mf)).toBe(35);
    expect(weeklyHoursTotal([...mf, { weekday: 6, startMinute: 720, endMinute: 1140 }])).toBe(42);
  });

  it('counts an inverted or empty window as 0 and null (inherit) as 0', () => {
    expect(weeklyHoursTotal([{ weekday: 1, startMinute: 1020, endMinute: 600 }, { weekday: 2, startMinute: 600, endMinute: 600 }])).toBe(0);
    expect(weeklyHoursTotal(null)).toBe(0);
    expect(weeklyHoursTotal([])).toBe(0);
  });

  it('pairs with daysToWindows for live editor rows (off days do not count)', () => {
    const days = windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1050 }]); // Mon 9:00–17:30, others off
    expect(weeklyHoursTotal(daysToWindows(days))).toBe(8.5);
  });
});

describe('weeklyHoursLabel', () => {
  it('rounds to one decimal and drops a trailing .0', () => {
    expect(weeklyHoursLabel(72)).toBe('72h per week');
    expect(weeklyHoursLabel(37.5)).toBe('37.5h per week');
    expect(weeklyHoursLabel(10 + 20 / 60)).toBe('10.3h per week');
    expect(weeklyHoursLabel(0)).toBe('0h per week');
  });
});

describe('coverage', () => {
  it('places a window on the 24h bar as left/width percentages', () => {
    expect(coverage('06:00', '18:00')).toEqual({ leftPct: 25, widthPct: 50 });
    expect(coverage('00:00', '24:00')).toEqual({ leftPct: 0, widthPct: 100 });
  });

  it('an end at or before the start has zero width (never negative)', () => {
    expect(coverage('17:00', '09:00')).toEqual({ leftPct: (17 / 24) * 100, widthPct: 0 });
    expect(coverage('09:00', '09:00').widthPct).toBe(0);
  });

  it('a blank (cleared) time input reads as midnight', () => {
    expect(coverage('', '12:00')).toEqual({ leftPct: 0, widthPct: 50 });
  });
});
