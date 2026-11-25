import { describe, it, expect } from 'vitest';
import type { Habit } from '../../api/types';
import { habitSummary, daysText } from './habitSummary';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('habitSummary', () => {
  it('counts active and paused habits and books chunk × times-per-week of the active ones only', () => {
    const s = habitSummary([
      habit({ chunkMs: 30 * 60_000, perPeriod: 7 }),          // 3.5h
      habit({ id: 'h2', chunkMs: 60 * 60_000, perPeriod: 7 }), // 7h
      habit({ id: 'h3', chunkMs: 30 * 60_000, perPeriod: 7 }), // 3.5h
      habit({ id: 'h4', chunkMs: 15 * 60_000, perPeriod: 4, status: 'paused' }), // not booked
    ]);
    expect(s).toEqual({ active: 3, paused: 1, weeklyMs: 14 * 3_600_000, weeklyLabel: '14h' });
  });

  it('keeps one decimal of hours and is all zero for no habits', () => {
    expect(habitSummary([habit({ chunkMs: 20 * 60_000, perPeriod: 4 })]).weeklyLabel).toBe('1.3h');
    expect(habitSummary([])).toEqual({ active: 0, paused: 0, weeklyMs: 0, weeklyLabel: '0h' });
  });
});

describe('daysText', () => {
  it('lists eligible days in weekday order, or "any day" for all seven', () => {
    expect(daysText([5, 1, 3])).toBe('Mon Wed Fri');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('any day');
    expect(daysText([])).toBe('no days');
  });
});
