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
});
