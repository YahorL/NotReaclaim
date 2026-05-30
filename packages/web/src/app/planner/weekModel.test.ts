import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import {
  startOfWeek, dayColumns, addWeeks, classifyBlock, placeInDay, nowLine, humanizeMs, isToday,
  WINDOW_START_MIN, WINDOW_END_MIN,
} from './weekModel';

const MON = Date.parse('2026-01-05T00:00:00.000Z'); // Monday 00:00 UTC
const WED_NOON = Date.parse('2026-01-07T12:00:00.000Z');

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Focus',
    startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0', ...over,
  };
}

describe('startOfWeek / dayColumns', () => {
  it('startOfWeek returns Monday 00:00 of the week', () => {
    expect(startOfWeek(WED_NOON)).toBe(MON);
    expect(startOfWeek(MON)).toBe(MON);
  });
  it('dayColumns returns 7 consecutive day starts', () => {
    const cols = dayColumns(MON);
    expect(cols).toHaveLength(7);
    expect(cols[0]).toBe(MON);
    expect(cols[6]).toBe(Date.parse('2026-01-11T00:00:00.000Z'));
  });
});

describe('addWeeks', () => {
  it('moves forward and backward by whole weeks to Monday midnight', () => {
    const MON2 = Date.parse('2026-01-12T00:00:00.000Z');
    expect(addWeeks(MON, 1)).toBe(MON2);
    expect(addWeeks(MON2, -1)).toBe(MON);
    expect(addWeeks(MON, 0)).toBe(MON);
  });
});

describe('classifyBlock', () => {
  it('classifies task vs habit and reads pinned', () => {
    expect(classifyBlock(block())).toEqual({ kind: 'task', pinned: false });
    expect(classifyBlock(block({ taskId: null, habitId: 'h1' }))).toEqual({ kind: 'habit', pinned: false });
    expect(classifyBlock(block({ pinned: true }))).toEqual({ kind: 'task', pinned: true });
  });
});

describe('placeInDay', () => {
  const dayStart = MON;
  it('positions a block within the 6:00-22:00 window', () => {
    const start = Date.parse('2026-01-05T09:00:00.000Z');
    const end = Date.parse('2026-01-05T09:30:00.000Z');
    const span = WINDOW_END_MIN - WINDOW_START_MIN; // 960
    expect(placeInDay(start, end, dayStart)).toEqual({
      topPct: ((540 - WINDOW_START_MIN) / span) * 100,
      heightPct: (30 / span) * 100,
    });
  });
  it('clamps a block that starts before the window', () => {
    const start = Date.parse('2026-01-05T05:00:00.000Z');
    const end = Date.parse('2026-01-05T07:00:00.000Z');
    const pos = placeInDay(start, end, dayStart)!;
    expect(pos.topPct).toBe(0);
    expect(pos.heightPct).toBeCloseTo((60 / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
  });
  it('returns null when the interval is outside the day window', () => {
    const start = Date.parse('2026-01-05T23:00:00.000Z');
    const end = Date.parse('2026-01-05T23:30:00.000Z');
    expect(placeInDay(start, end, dayStart)).toBeNull();
    expect(placeInDay(Date.parse('2026-01-06T09:00:00.000Z'), Date.parse('2026-01-06T10:00:00.000Z'), dayStart)).toBeNull();
  });
});

describe('nowLine', () => {
  it('returns a position when now is inside the day window, else null', () => {
    const pos = nowLine(WED_NOON, Date.parse('2026-01-07T00:00:00.000Z'));
    expect(pos).toBeCloseTo(((720 - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
    expect(nowLine(WED_NOON, MON)).toBeNull();
  });
});

describe('isToday', () => {
  it('is true within the day and false otherwise', () => {
    const day = Date.parse('2026-01-07T00:00:00.000Z');
    expect(isToday(Date.parse('2026-01-07T12:00:00.000Z'), day)).toBe(true);
    expect(isToday(Date.parse('2026-01-07T00:00:00.000Z'), day)).toBe(true);   // inclusive start
    expect(isToday(Date.parse('2026-01-08T00:00:00.000Z'), day)).toBe(false);  // exclusive end
    expect(isToday(Date.parse('2026-01-06T23:59:59.000Z'), day)).toBe(false);
  });
});

describe('humanizeMs', () => {
  it('formats durations', () => {
    expect(humanizeMs(90 * 60000)).toBe('1h 30m');
    expect(humanizeMs(30 * 60000)).toBe('30m');
    expect(humanizeMs(2 * 3600000)).toBe('2h');
  });
});
