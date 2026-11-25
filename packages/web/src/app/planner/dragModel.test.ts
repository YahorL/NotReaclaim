import { describe, it, expect } from 'vitest';
import { moveTarget, resizeTarget, targetTimes, moveLabel, resizeLabel, pastThreshold, DRAG_THRESHOLD_PX } from './dragModel';
import { minutesToPx, WINDOW_END_MIN } from './weekModel';

const PX_15 = minutesToPx(15);
const PX_60 = minutesToPx(60);

describe('pastThreshold', () => {
  it('is false under 5px of combined travel and true from 5px', () => {
    expect(DRAG_THRESHOLD_PX).toBe(5);
    expect(pastThreshold(0, 0)).toBe(false);
    expect(pastThreshold(2, 2)).toBe(false);
    expect(pastThreshold(3, 2)).toBe(true);
    expect(pastThreshold(-5, 0)).toBe(true);
    expect(pastThreshold(0, -4)).toBe(false);
  });

  it('takes a custom threshold', () => {
    expect(pastThreshold(6, 0, 8)).toBe(false);
    expect(pastThreshold(8, 0, 8)).toBe(true);
  });
});

describe('moveTarget', () => {
  const base = { origDay: 2, origStartMin: 9 * 60, durationMin: 60, dx: 0, dy: 0, colWidth: 120, dayCount: 7 };

  it('stays put without travel', () => {
    expect(moveTarget(base)).toEqual({ dayIndex: 2, startMin: 540 });
  });

  it('snaps the vertical delta to 15 minutes (sub-step travel → no change)', () => {
    expect(moveTarget({ ...base, dy: minutesToPx(7) })).toEqual({ dayIndex: 2, startMin: 540 });
    expect(moveTarget({ ...base, dy: minutesToPx(8) })).toEqual({ dayIndex: 2, startMin: 555 });
    expect(moveTarget({ ...base, dy: PX_60 })).toEqual({ dayIndex: 2, startMin: 600 });
  });

  it('moves up with a negative delta', () => {
    expect(moveTarget({ ...base, dy: -2 * PX_15 })).toEqual({ dayIndex: 2, startMin: 510 });
  });

  it('keeps an off-grid start off-grid: the DELTA snaps, not the start (a 9:05 block moves to 9:20)', () => {
    expect(moveTarget({ ...base, origStartMin: 545, dy: PX_15 })).toEqual({ dayIndex: 2, startMin: 560 });
  });

  it('rounds the horizontal travel to whole columns', () => {
    expect(moveTarget({ ...base, dx: 59 })).toEqual({ dayIndex: 2, startMin: 540 });
    expect(moveTarget({ ...base, dx: 61 })).toEqual({ dayIndex: 3, startMin: 540 });
    expect(moveTarget({ ...base, dx: -130 })).toEqual({ dayIndex: 1, startMin: 540 });
  });

  it('clamps the day to the rendered columns', () => {
    expect(moveTarget({ ...base, dx: 1000 })).toEqual({ dayIndex: 6, startMin: 540 });
    expect(moveTarget({ ...base, dx: -1000 })).toEqual({ dayIndex: 0, startMin: 540 });
    expect(moveTarget({ ...base, origDay: 0, dayCount: 1, dx: 500 })).toEqual({ dayIndex: 0, startMin: 540 });
    expect(moveTarget({ ...base, origDay: 1, dayCount: 3, dx: 400 })).toEqual({ dayIndex: 2, startMin: 540 });
  });

  it('clamps the start so the whole block stays inside the 24h window', () => {
    expect(moveTarget({ ...base, dy: -100 * PX_60 })).toEqual({ dayIndex: 2, startMin: 0 });
    expect(moveTarget({ ...base, dy: 100 * PX_60 })).toEqual({ dayIndex: 2, startMin: WINDOW_END_MIN - 60 });
  });

  it('ignores horizontal travel when the column width is unknown', () => {
    expect(moveTarget({ ...base, colWidth: 0, dx: 500 })).toEqual({ dayIndex: 2, startMin: 540 });
  });

  it('divides by the render scale (a zoomed layer reports 2× client pixels)', () => {
    // At scale 2 a 2-hour client-pixel travel is one layout hour; the column width is client px too.
    expect(moveTarget({ ...base, dy: 2 * PX_60, scale: 2 })).toEqual({ dayIndex: 2, startMin: 600 });
    expect(moveTarget({ ...base, dx: 250, colWidth: 240, scale: 2 })).toEqual({ dayIndex: 3, startMin: 540 });
  });

  it('treats a non-finite or zero scale as 1', () => {
    expect(moveTarget({ ...base, dy: PX_60, scale: 0 })).toEqual({ dayIndex: 2, startMin: 600 });
    expect(moveTarget({ ...base, dy: PX_60, scale: Number.NaN })).toEqual({ dayIndex: 2, startMin: 600 });
  });
});

describe('resizeTarget', () => {
  const base = { startMin: 9 * 60, origEndMin: 10 * 60, dy: 0 };

  it('extends the end by the snapped delta', () => {
    expect(resizeTarget({ ...base, dy: PX_60 })).toEqual({ endMin: 660 });
    expect(resizeTarget({ ...base, dy: minutesToPx(20) })).toEqual({ endMin: 615 });
  });

  it('shrinks with a negative delta but never below 15 minutes', () => {
    expect(resizeTarget({ ...base, dy: -PX_15 })).toEqual({ endMin: 585 });
    expect(resizeTarget({ ...base, dy: -10 * PX_60 })).toEqual({ endMin: 555 });
  });

  it('never runs past the window end', () => {
    expect(resizeTarget({ ...base, dy: 100 * PX_60 })).toEqual({ endMin: WINDOW_END_MIN });
  });

  it('a zero delta is a no-op', () => {
    expect(resizeTarget(base)).toEqual({ endMin: 600 });
  });

  it('divides by the render scale', () => {
    expect(resizeTarget({ ...base, dy: 2 * PX_60, scale: 2 })).toEqual({ endMin: 660 });
  });
});

describe('targetTimes', () => {
  const DAY = Date.parse('2026-01-05T00:00:00.000Z');

  it('builds the target interval from the column anchor plus minutes', () => {
    expect(targetTimes({ dayStartMs: DAY, dayDelta: 0, startMin: 600, endMin: 660, zone: 'UTC' })).toEqual({
      startMs: Date.parse('2026-01-05T10:00:00.000Z'), endMs: Date.parse('2026-01-05T11:00:00.000Z'),
    });
  });

  it('shifts by whole wall-clock days', () => {
    expect(targetTimes({ dayStartMs: DAY, dayDelta: 2, startMin: 540, endMin: 600, zone: 'UTC' })).toEqual({
      startMs: Date.parse('2026-01-07T09:00:00.000Z'), endMs: Date.parse('2026-01-07T10:00:00.000Z'),
    });
  });

  it('keeps the wall clock across a DST transition (New York, day start 03:00)', () => {
    // Column anchors: Sat 7 Mar 03:00 EST = 08:00Z; Sun 8 Mar 03:00 EDT = 07:00Z.
    const sat = Date.parse('2026-03-07T08:00:00.000Z');
    const r = targetTimes({ dayStartMs: sat, dayDelta: 1, startMin: 6 * 60, endMin: 7 * 60, zone: 'America/New_York' });
    // 09:00 EDT on the 8th, not a blind +24h (which would read 10:00 EDT).
    expect(new Date(r.startMs).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(new Date(r.endMs).toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });
});

describe('ghost labels', () => {
  it('a move reads "<weekday of the column> · <start>"', () => {
    const sat = Date.parse('2026-01-10T00:00:00.000Z');
    expect(moveLabel(sat, Date.parse('2026-01-10T00:15:00.000Z'), 'UTC')).toMatch(/^Sat · 12:15\sAM$/);
  });

  it('names the COLUMN\'s weekday, not the wall-clock date (day start 03:00: 01:30 Sun sits on Sat)', () => {
    const sat3am = Date.parse('2026-01-10T03:00:00.000Z');
    expect(moveLabel(sat3am, Date.parse('2026-01-11T01:30:00.000Z'), 'UTC')).toMatch(/^Sat · 1:30\sAM$/);
  });

  it('a move label follows the settings zone', () => {
    const satNy = Date.parse('2026-01-10T05:00:00.000Z'); // Sat 00:00 New York
    expect(moveLabel(satNy, Date.parse('2026-01-11T02:15:00.000Z'), 'America/New_York')).toMatch(/^Sat · 9:15\sPM$/);
  });

  it('a resize reads "<duration> · ends <end>"', () => {
    expect(resizeLabel(75, Date.parse('2026-01-10T21:15:00.000Z'), 'UTC')).toMatch(/^1h 15m · ends 9:15\sPM$/);
    expect(resizeLabel(60, Date.parse('2026-01-10T21:00:00.000Z'), 'UTC')).toMatch(/^1h · ends 9:00\sPM$/);
    expect(resizeLabel(15, Date.parse('2026-01-10T09:15:00.000Z'), 'UTC')).toMatch(/^15m · ends 9:15\sAM$/);
  });
});
