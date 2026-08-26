import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import {
  startOfWeek, dayColumns, addWeeks, classifyBlock, placeInDay, nowLine, humanizeMs, isToday,
  WINDOW_START_MIN, WINDOW_END_MIN,
  HOUR_ROW_PX, GRID_COLUMN_PX, snapMinutes, pxToMinutes, clampToWindow,
  minutesToPx, shiftDays, clampDayDelta, snapClickToSlot, localMidnight,
  daysThatFit, formatHm, weekdayLabel, dayOfMonth, dayAnchor, hourRowLabel,
  MOBILE_TIME_GUTTER_PX, MOBILE_MIN_DAY_COL_PX, timeGutterPx, popoverAlign, rangeLabel,
  COARSE_RESIZE_MIN_SPAN_MIN, resizeHandleClass,
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

describe('weekModel timezone-aware (America/New_York)', () => {
  const Z = 'America/New_York';
  const noonZ = Date.parse('2026-06-18T16:00:00.000Z'); // 12:00 EDT (UTC-4)

  it('localMidnight returns the zone midnight (04:00Z in summer EDT)', () => {
    expect(localMidnight(noonZ, Z)).toBe(Date.parse('2026-06-18T04:00:00.000Z'));
  });
  it('dayColumns steps zone days', () => {
    const cols = dayColumns(localMidnight(noonZ, Z), 2, Z);
    expect(cols[0]).toBe(Date.parse('2026-06-18T04:00:00.000Z'));
    expect(cols[1]).toBe(Date.parse('2026-06-19T04:00:00.000Z'));
  });
  it('shiftDays preserves wall-clock in the zone', () => {
    expect(shiftDays(noonZ, 1, Z)).toBe(Date.parse('2026-06-19T16:00:00.000Z'));
  });
  it('formats labels in the zone', () => {
    expect(formatHm(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe('09:00 AM'); // 13:00Z = 9am EDT
    expect(weekdayLabel(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe('Thu');
    expect(dayOfMonth(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe(18);
  });
  it('places a 09:00-EDT block against the zone midnight at 540/1440', () => {
    const dayStart = localMidnight(noonZ, Z);
    const pos = placeInDay(Date.parse('2026-06-18T13:00:00.000Z'), Date.parse('2026-06-18T14:00:00.000Z'), dayStart)!;
    expect(pos.topPct).toBeCloseTo((540 / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
  });
});

describe('dayStartMinute — shifted day boundary (Review 20)', () => {
  const D = (iso: string) => Date.parse(iso);

  it('defaults to the midnight boundary (dayAnchor === localMidnight)', () => {
    expect(dayAnchor(WED_NOON)).toBe(localMidnight(WED_NOON));
    expect(dayAnchor(MON)).toBe(MON);
    expect(dayColumns(MON, 3, 'UTC', 0)).toEqual(dayColumns(MON, 3));
  });

  it('anchors a timestamp to the column whose [start, next start) contains it', () => {
    // 03:00 day start: 01:30 on the 7th still belongs to the 6th's column
    expect(dayAnchor(D('2026-01-07T01:30:00.000Z'), 'UTC', 180)).toBe(D('2026-01-06T03:00:00.000Z'));
    expect(dayAnchor(D('2026-01-07T03:00:00.000Z'), 'UTC', 180)).toBe(D('2026-01-07T03:00:00.000Z'));
    expect(dayAnchor(D('2026-01-07T02:59:59.999Z'), 'UTC', 180)).toBe(D('2026-01-06T03:00:00.000Z'));
    expect(dayAnchor(D('2026-01-07T23:00:00.000Z'), 'UTC', 180)).toBe(D('2026-01-07T03:00:00.000Z'));
    // a non-hour boundary works too (03:30)
    expect(dayAnchor(D('2026-01-07T03:15:00.000Z'), 'UTC', 210)).toBe(D('2026-01-06T03:30:00.000Z'));
  });

  it('dayColumns steps whole days keeping the wall-clock anchor', () => {
    const cols = dayColumns(D('2026-01-05T09:00:00.000Z'), 3, 'UTC', 180);
    expect(cols).toEqual([
      D('2026-01-05T03:00:00.000Z'), D('2026-01-06T03:00:00.000Z'), D('2026-01-07T03:00:00.000Z'),
    ]);
  });

  it('keeps the 03:00 wall clock across both DST transitions (America/New_York)', () => {
    const Z = 'America/New_York';
    // spring forward 2026-03-08 (02:00 EST → 03:00 EDT): the 7th's column is 23h long
    const spring = dayColumns(D('2026-03-07T12:00:00.000Z'), 3, Z, 180);
    expect(spring).toEqual([
      D('2026-03-07T08:00:00.000Z'), // 03:00 EST
      D('2026-03-08T07:00:00.000Z'), // 03:00 EDT
      D('2026-03-09T07:00:00.000Z'),
    ]);
    expect(spring[1]! - spring[0]!).toBe(23 * 60 * 60 * 1000);
    // fall back 2026-11-01 (02:00 EDT → 01:00 EST): the Oct 31 column is 25h long
    const fall = dayColumns(D('2026-10-31T12:00:00.000Z'), 2, Z, 180);
    expect(fall).toEqual([D('2026-10-31T07:00:00.000Z'), D('2026-11-01T08:00:00.000Z')]);
    expect(fall[1]! - fall[0]!).toBe(25 * 60 * 60 * 1000);
    // and the anchor of a 01:30-EST instant on Nov 2 is still Nov 1's column
    expect(dayAnchor(D('2026-11-02T06:30:00.000Z'), Z, 180)).toBe(D('2026-11-01T08:00:00.000Z'));
  });

  it('places a 01:00 block on the previous date column, 22h down', () => {
    const col = dayAnchor(D('2026-01-07T01:00:00.000Z'), 'UTC', 180); // = Jan 6 03:00
    const pos = placeInDay(D('2026-01-07T01:00:00.000Z'), D('2026-01-07T02:00:00.000Z'), col)!;
    const span = WINDOW_END_MIN - WINDOW_START_MIN;
    expect(pos.topPct).toBeCloseTo((22 * 60 / span) * 100, 5);
    expect(pos.heightPct).toBeCloseTo((60 / span) * 100, 5);
  });

  it('clips a block that straddles the column boundary at the column edge', () => {
    const col = D('2026-01-06T03:00:00.000Z');
    // 02:00 → 04:00 on the 7th: 23h..25h since the column start → clipped to the last hour
    const pos = placeInDay(D('2026-01-07T02:00:00.000Z'), D('2026-01-07T04:00:00.000Z'), col)!;
    const span = WINDOW_END_MIN - WINDOW_START_MIN;
    expect(pos.topPct).toBeCloseTo((23 * 60 / span) * 100, 5);
    expect(pos.heightPct).toBeCloseTo((60 / span) * 100, 5);
    // the same block against the NEXT column starts at its top
    const next = placeInDay(D('2026-01-07T02:00:00.000Z'), D('2026-01-07T04:00:00.000Z'), D('2026-01-07T03:00:00.000Z'))!;
    expect(next.topPct).toBe(0);
    expect(next.heightPct).toBeCloseTo((60 / span) * 100, 5);
  });

  it('selects the previous date column as "today" at 01:30 with a 03:00 day start', () => {
    const now = D('2026-01-07T01:30:00.000Z');
    const cols = dayColumns(D('2026-01-05T12:00:00.000Z'), 3, 'UTC', 180);
    expect(cols.map((c) => isToday(now, c))).toEqual([false, true, false]); // Jan 6's column
    // 01:30 on the 7th is 22.5h into the 6th's column
    expect(nowLine(now, cols[1]!)).toBeCloseTo((22.5 * 60 / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
  });

  it('snaps clicks and clamps durations relative to the column start', () => {
    const col = D('2026-01-06T03:00:00.000Z');
    // half-way down a 03:00-anchored column is 15:00 wall clock
    expect(col + snapClickToSlot(0.5) * 60_000).toBe(D('2026-01-06T15:00:00.000Z'));
    // a 2h slot dropped near the bottom is pulled back so it ends at the column edge (03:00)
    const { startMin, endMin } = clampToWindow(snapClickToSlot(0.99), 120);
    expect(col + startMin * 60_000).toBe(D('2026-01-07T01:00:00.000Z'));
    expect(col + endMin * 60_000).toBe(D('2026-01-07T03:00:00.000Z'));
  });

  it('rotates the hour-gutter labels to start at the day-start hour', () => {
    expect([0, 9, 12, 13, 23].map((h) => hourRowLabel(h))).toEqual(['12a', '9a', '12p', '1p', '11p']);
    expect([0, 1, 20, 21, 23].map((h) => hourRowLabel(h, 180))).toEqual(['3a', '4a', '11p', '12a', '2a']);
    expect(hourRowLabel(0, 210)).toBe('3:30a');
  });
});

describe('mobile geometry (Phase 2)', () => {
  it('exports the mobile gutter and column-minimum constants', () => {
    expect(MOBILE_TIME_GUTTER_PX).toBe(44);
    expect(MOBILE_MIN_DAY_COL_PX).toBe(175);
  });

  it('timeGutterPx narrows the gutter only in the compact layout', () => {
    expect(timeGutterPx()).toBe(64);
    expect(timeGutterPx(false)).toBe(64);
    expect(timeGutterPx(true)).toBe(44);
  });

  it('compact widths: a 390px phone shows one day, a 430px phone shows two', () => {
    expect(daysThatFit(358, true)).toBe(1);  // 390 - p-4
    expect(daysThatFit(374, true)).toBe(1);  // 390 - p-2
    expect(daysThatFit(390, true)).toBe(1);  // full bleed
    expect(daysThatFit(398, true)).toBe(2);  // 430 - p-4
    expect(daysThatFit(414, true)).toBe(2);  // 430 - p-2
    expect(daysThatFit(430, true)).toBe(2);  // full bleed
    expect(daysThatFit(767, true)).toBe(4);  // widest compact viewport
  });

  it('compact keeps the unmeasured sentinel and the 1-day floor', () => {
    expect(daysThatFit(-1, true)).toBe(7);
    expect(daysThatFit(0, true)).toBe(1);
    expect(daysThatFit(50, true)).toBe(1);
  });

  it('desktop widths are untouched by the new parameter', () => {
    expect(daysThatFit(768)).toBe(5);
    expect(daysThatFit(768, false)).toBe(5);
    expect(daysThatFit(1280)).toBe(7);
    expect(daysThatFit(640)).toBe(4);   // the real grid pane at 1280 with both side panels
    expect(daysThatFit(640, false)).toBe(4);
  });
});

describe('popoverAlign', () => {
  it('reproduces the old hardcoded 7-day rule (i <= 3 opens left)', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => popoverAlign(i, 7)))
      .toEqual(['left', 'left', 'left', 'left', 'right', 'right', 'right']);
  });

  it('follows the rendered day count in the narrow windows', () => {
    expect(popoverAlign(0, 1)).toBe('left');
    expect([0, 1].map((i) => popoverAlign(i, 2))).toEqual(['left', 'right']);
    expect([0, 1, 2].map((i) => popoverAlign(i, 3))).toEqual(['left', 'left', 'right']);
    expect([0, 1, 2, 3].map((i) => popoverAlign(i, 4))).toEqual(['left', 'left', 'right', 'right']);
  });
});

describe('rangeLabel', () => {
  it('renders a single date for a one-day window', () => {
    expect(rangeLabel([MON])).toBe('Jan 5');
  });

  it('renders first – last for a multi-day window', () => {
    expect(rangeLabel(dayColumns(MON))).toBe('Jan 5 – Jan 11');
    expect(rangeLabel(dayColumns(MON, 2))).toBe('Jan 5 – Jan 6');
  });
});

describe('resizeHandleClass', () => {
  const pct = (min: number) => (min / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100;

  it('a fine pointer always gets the 6px bar', () => {
    expect(resizeHandleClass(pct(60), false)).toBe('h-1.5');
    expect(resizeHandleClass(pct(15), false)).toBe('h-1.5');
  });

  it('a coarse pointer gets the 24px target on tiles of 30 minutes or more', () => {
    expect(resizeHandleClass(pct(30), true)).toBe('h-6');
    expect(resizeHandleClass(pct(60), true)).toBe('h-6');
    expect(resizeHandleClass(pct(480), true)).toBe('h-6');
  });

  it('keeps the small target on short tiles a 24px handle would swallow', () => {
    expect(resizeHandleClass(pct(15), true)).toBe('h-1.5');
    expect(resizeHandleClass(pct(29), true)).toBe('h-1.5');
    expect(COARSE_RESIZE_MIN_SPAN_MIN).toBe(30);
  });
});
