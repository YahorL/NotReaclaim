import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import {
  startOfWeek, dayColumns, addWeeks, classifyBlock, placeInDay, nowLine, humanizeMs, isToday,
  WINDOW_START_MIN, WINDOW_END_MIN,
  HOUR_ROW_PX, GRID_COLUMN_PX, snapMinutes, pxToMinutes, clampToWindow,
  minutesToPx, shiftDays, clampDayDelta, snapClickToSlot, localMidnight,
  daysThatFit,
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
  it('clamps a block that extends past the end of the day', () => {
    const start = Date.parse('2026-01-05T23:00:00.000Z');
    const end = Date.parse('2026-01-06T01:00:00.000Z'); // 25:00 → clamps to 24:00
    const pos = placeInDay(start, end, dayStart)!;
    const span = WINDOW_END_MIN - WINDOW_START_MIN; // 1440
    expect(pos.topPct).toBeCloseTo((1380 / span) * 100, 5); // 23:00
    expect(pos.heightPct).toBeCloseTo((60 / span) * 100, 5); // 23:00–24:00
  });
  it('places early/late same-day blocks and returns null for a different day', () => {
    // 05:00 used to be clipped; now it places within the full-day window
    expect(placeInDay(Date.parse('2026-01-05T05:00:00.000Z'), Date.parse('2026-01-05T05:30:00.000Z'), dayStart)).not.toBeNull();
    expect(placeInDay(Date.parse('2026-01-05T23:00:00.000Z'), Date.parse('2026-01-05T23:30:00.000Z'), dayStart)).not.toBeNull();
    // a different day still returns null
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

describe('grid geometry', () => {
  it('exports the fixed column geometry constants', () => {
    expect(HOUR_ROW_PX).toBe(58);
    expect(GRID_COLUMN_PX).toBe(((WINDOW_END_MIN - WINDOW_START_MIN) / 60) * 58); // 24 * 58 = 1392
  });

  it('snapMinutes rounds to the nearest step (default 15)', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
    expect(snapMinutes(52, 30)).toBe(60);
  });

  it('pxToMinutes maps the column height to the full window span', () => {
    expect(pxToMinutes(GRID_COLUMN_PX)).toBe(WINDOW_END_MIN - WINDOW_START_MIN); // 1392px -> 1440 min
    expect(Math.round(pxToMinutes(HOUR_ROW_PX))).toBe(60); // one row -> 60 min
    expect(pxToMinutes(0)).toBe(0);
    expect(pxToMinutes(-GRID_COLUMN_PX)).toBe(-(WINDOW_END_MIN - WINDOW_START_MIN));
  });

  it('clampToWindow floors start at the window start and shifts back on overflow', () => {
    expect(clampToWindow(540, 60)).toEqual({ startMin: 540, endMin: 600 });
    expect(clampToWindow(-30, 60)).toEqual({ startMin: WINDOW_START_MIN, endMin: WINDOW_START_MIN + 60 });
    expect(clampToWindow(1410, 60)).toEqual({ startMin: WINDOW_END_MIN - 60, endMin: WINDOW_END_MIN });
  });
});

describe('minutesToPx', () => {
  it('is the inverse of pxToMinutes', () => {
    expect(minutesToPx(60)).toBeCloseTo(58);
    expect(minutesToPx(15)).toBeCloseTo(14.5);
    expect(pxToMinutes(minutesToPx(37))).toBeCloseTo(37);
    expect(minutesToPx(0)).toBe(0);
    expect(minutesToPx(-30)).toBeCloseTo(-29);
  });
});

describe('shiftDays', () => {
  const MON = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight under TZ=UTC
  it('shifts whole days preserving wall-clock time', () => {
    expect(shiftDays(MON, 1)).toBe(Date.parse('2026-01-06T00:00:00.000Z'));
    expect(shiftDays(MON, -2)).toBe(Date.parse('2026-01-03T00:00:00.000Z'));
    const nineFifteen = Date.parse('2026-01-05T09:15:00.000Z');
    expect(shiftDays(nineFifteen, 3)).toBe(Date.parse('2026-01-08T09:15:00.000Z'));
  });
  it('zero days is identity', () => {
    expect(shiftDays(MON, 0)).toBe(MON);
  });
});

describe('clampDayDelta', () => {
  it('keeps dayIndex+delta within the rendered week [0,6]', () => {
    expect(clampDayDelta(0, -3)).toBe(0);
    expect(clampDayDelta(0, 3)).toBe(3);
    expect(clampDayDelta(6, 3)).toBe(0);
    expect(clampDayDelta(6, -2)).toBe(-2);
    expect(clampDayDelta(3, 9)).toBe(3);
    expect(clampDayDelta(3, -9)).toBe(-3);
    expect(clampDayDelta(2, 0)).toBe(0);
  });
});

describe('snapClickToSlot', () => {
  it('maps a clicked offset fraction to a snapped, clamped start minute', () => {
    expect(snapClickToSlot(0)).toBe(WINDOW_START_MIN);       // top of the window (00:00)
    expect(snapClickToSlot(0.5)).toBe(720);                  // 12:00
    expect(snapClickToSlot(0.99)).toBe(WINDOW_END_MIN - 15); // clamped so a 15-min slot fits (23:45)
    expect(snapClickToSlot(-0.2)).toBe(WINDOW_START_MIN);
  });
});

describe('localMidnight', () => {
  it('strips hours/minutes/seconds to local midnight', () => {
    // MON is already 2026-01-05T00:00:00.000Z (= local midnight under TZ=UTC)
    expect(localMidnight(MON)).toBe(MON);
    // noon on Wednesday → same Wednesday midnight
    expect(localMidnight(WED_NOON)).toBe(Date.parse('2026-01-07T00:00:00.000Z'));
    // one millisecond before midnight is still the prior day's midnight
    const beforeMidnight = Date.parse('2026-01-06T23:59:59.999Z');
    expect(localMidnight(beforeMidnight)).toBe(Date.parse('2026-01-06T00:00:00.000Z'));
  });
});

describe('dayColumns(count)', () => {
  it('returns the requested number of consecutive local-midnight days', () => {
    const start = new Date('2026-01-07T00:00:00').getTime();
    expect(dayColumns(start, 3)).toHaveLength(3);
    expect(dayColumns(start, 3)[1]).toBe(new Date('2026-01-08T00:00:00').getTime());
    expect(dayColumns(start)).toHaveLength(7); // default
  });
});

describe('clampDayDelta(lastIndex)', () => {
  it('clamps the day delta to [-dayIndex, lastIndex - dayIndex]', () => {
    expect(clampDayDelta(0, 5, 2)).toBe(2);   // last index 2
    expect(clampDayDelta(2, -5, 2)).toBe(-2);
    expect(clampDayDelta(1, 1, 6)).toBe(1);
  });
});

describe('daysThatFit', () => {
  it('returns 7 only for an unmeasured (negative) width; a measured 0 width floors to 1 day', () => {
    expect(daysThatFit(-1)).toBe(7);
    expect(daysThatFit(0)).toBe(1);
    expect(daysThatFit(50)).toBe(1);
  });
  it('fits more days as width grows, capped at 7 and floored at 1', () => {
    expect(daysThatFit(64 + 120 * 3 + 10)).toBe(3);
    expect(daysThatFit(64 + 120 * 20)).toBe(7);
    expect(daysThatFit(100)).toBe(1);
  });
});
