import { describe, it, expect } from 'vitest';
import { routeHeader, routeTitle } from './routeHeader';

// Tuesday 2026-11-24 15:00 UTC.
const NOW = Date.parse('2026-11-24T15:00:00Z');
const ctx = { nowMs: NOW, zone: 'UTC', openTaskCount: 14 };

describe('routeHeader', () => {
  it('Planner: long date + ISO week eyebrow, "Your week planner"', () => {
    expect(routeHeader('/', ctx)).toEqual({
      eyebrow: 'Tuesday, November 24 · Week 48',
      title: ['Your ', 'week', ' planner'],
    });
  });

  it('Priorities: open-task count eyebrow (singular, unknown)', () => {
    expect(routeHeader('/priorities', ctx)).toEqual({
      eyebrow: '14 open tasks across 4 priority levels · drag to reorder',
      title: ['Your ', 'priorities', ''],
    });
    expect(routeHeader('/priorities', { ...ctx, openTaskCount: 1 }).eyebrow).toBe('1 open task across 4 priority levels · drag to reorder');
    expect(routeHeader('/priorities', { ...ctx, openTaskCount: null }).eyebrow).toBe('Tasks across 4 priority levels · drag to reorder');
  });

  it('Stats: the Mon–Sun week the Stats page reports on', () => {
    expect(routeHeader('/stats', ctx)).toEqual({
      eyebrow: 'Week 48 · Nov 23 – Nov 29',
      title: ['Your ', 'stats', ''],
    });
  });

  it('Time-management pages and Settings', () => {
    expect(routeHeader('/habits', ctx)).toEqual({ eyebrow: 'Time management', title: ['Your ', 'habits', ''] });
    expect(routeHeader('/buffers', ctx)).toEqual({ eyebrow: 'Time management', title: ['Scheduling ', 'buffers', ''] });
    expect(routeHeader('/hours', ctx)).toEqual({ eyebrow: 'Time management', title: ['Your ', 'hours', ''] });
    expect(routeHeader('/settings', ctx)).toEqual({ eyebrow: 'Preferences', title: ['', 'Settings', ''] });
  });

  it('falls back to the app name for unknown routes', () => {
    expect(routeHeader('/nope', ctx)).toEqual({ eyebrow: '', title: ['', 'NotReclaim', ''] });
  });

  it('reads the date and week number in the settings zone (across a year boundary)', () => {
    // Monday 2027-01-04 02:00 UTC is still Sunday Jan 3 in New York: ISO week 53 of 2026 there,
    // week 1 of 2027 in UTC.
    const t = Date.parse('2027-01-04T02:00:00Z');
    expect(routeHeader('/', { nowMs: t, zone: 'UTC', openTaskCount: 0 }).eyebrow).toBe('Monday, January 4 · Week 1');
    expect(routeHeader('/', { nowMs: t, zone: 'America/New_York', openTaskCount: 0 }).eyebrow).toBe('Sunday, January 3 · Week 53');
    expect(routeHeader('/stats', { nowMs: t, zone: 'America/New_York', openTaskCount: 0 }).eyebrow).toBe('Week 53 · Dec 28 – Jan 3');
  });
});

describe('routeTitle (compact top bar)', () => {
  it('maps known routes to short titles', () => {
    expect(routeTitle('/')).toBe('Planner');
    expect(routeTitle('/priorities')).toBe('Priorities');
    expect(routeTitle('/habits')).toBe('Habits');
    expect(routeTitle('/settings')).toBe('Settings');
    expect(routeTitle('/stats')).toBe('Stats');
    expect(routeTitle('/buffers')).toBe('Buffers');
    expect(routeTitle('/hours')).toBe('Hours');
  });
  it('falls back to the app name for unknown routes', () => {
    expect(routeTitle('/nope')).toBe('NotReclaim');
  });
});
