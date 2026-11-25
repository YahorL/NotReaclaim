import { describe, it, expect } from 'vitest';
import { windowsToDays, daysToWindows, validateCategoryForm } from './categoryForm';

describe('categoryForm', () => {
  it('windowsToDays marks listed weekdays enabled and others off', () => {
    const days = windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    expect(days).toHaveLength(7);
    expect(days.find((d) => d.weekday === 1)).toMatchObject({ enabled: true, start: '09:00', end: '17:00' });
    expect(days.find((d) => d.weekday === 2)!.enabled).toBe(false);
  });

  it('daysToWindows emits only enabled days, sorted', () => {
    const days = windowsToDays([{ weekday: 3, startMinute: 600, endMinute: 660 }]);
    expect(daysToWindows(days)).toEqual([{ weekday: 3, startMinute: 600, endMinute: 660 }]);
  });

  it('validation requires a name and at least one valid window', () => {
    expect(validateCategoryForm('', windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1020 }])).ok).toBe(false);
    const noDays = windowsToDays([]);
    expect(validateCategoryForm('X', noDays).ok).toBe(false);
  });

  it('a cleared start or end time is an error, never a silent 00:00', () => {
    const days = windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    const cleared = (patch: { start?: string; end?: string }) => days.map((d) => (d.weekday === 1 ? { ...d, ...patch } : d));
    expect(validateCategoryForm('X', cleared({ start: '' }))).toEqual({ ok: false, error: 'Enter a start and end time' });
    expect(validateCategoryForm('X', cleared({ end: '' }))).toEqual({ ok: false, error: 'Enter a start and end time' });
    // An off day's cleared times do not matter.
    expect(validateCategoryForm('X', days.map((d) => (d.weekday === 2 ? { ...d, start: '' } : d))).ok).toBe(true);
  });
});
