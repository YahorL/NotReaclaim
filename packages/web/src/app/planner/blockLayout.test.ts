import { describe, it, expect } from 'vitest';
import { layoutWeek, blockLeftCss, blockWidthCss, INSET_PX, LANE_GAP_PX } from './blockLayout';
import { dayColumns, placeInDay } from './weekModel';

const H = 3_600_000;
const MON = Date.parse('2026-01-05T00:00:00.000Z');
const item = (key: string, startIso: string, endIso: string) => ({ key, startMs: Date.parse(startIso), endMs: Date.parse(endIso) });

describe('layoutWeek', () => {
  it('places a single block in its day column across the whole column width share (7 days)', () => {
    const days = dayColumns(MON, 7, 'UTC');
    const out = layoutWeek([item('a', '2026-01-07T06:00:00.000Z', '2026-01-07T07:00:00.000Z')], days);
    const a = out.get('a')!;
    expect(a.dayIndex).toBe(2);
    expect(a.topPct).toBe(25);
    expect(a.heightPct).toBeCloseTo(100 / 24);
    expect(a.leftPct).toBeCloseTo((2 / 7) * 100);
    expect(a.widthPct).toBeCloseTo((1 / 7) * 100);
    expect(a).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('a 1-day window gives the block the whole layer', () => {
    const out = layoutWeek([item('a', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z')], [MON]);
    expect(out.get('a')).toMatchObject({ dayIndex: 0, leftPct: 0, widthPct: 100 });
  });

  it('3-day window: the third column starts two thirds across', () => {
    const days = dayColumns(MON, 3, 'UTC');
    const out = layoutWeek([item('c', '2026-01-07T09:00:00.000Z', '2026-01-07T10:00:00.000Z')], days);
    expect(out.get('c')!.dayIndex).toBe(2);
    expect(out.get('c')!.leftPct).toBeCloseTo((2 / 3) * 100);
    expect(out.get('c')!.widthPct).toBeCloseTo((1 / 3) * 100);
  });

  it('two overlapping blocks split the right column into halves', () => {
    const days = dayColumns(MON, 7, 'UTC');
    const out = layoutWeek([
      item('x', '2026-01-06T09:00:00.000Z', '2026-01-06T11:00:00.000Z'),
      item('y', '2026-01-06T10:00:00.000Z', '2026-01-06T12:00:00.000Z'),
    ], days);
    const x = out.get('x')!;
    const y = out.get('y')!;
    expect(x).toMatchObject({ dayIndex: 1, lane: 0, lanes: 2 });
    expect(y).toMatchObject({ dayIndex: 1, lane: 1, lanes: 2 });
    expect(x.widthPct).toBeCloseTo((1 / 14) * 100);
    expect(x.leftPct).toBeCloseTo((1 / 7) * 100);
    expect(y.leftPct).toBeCloseTo(((1 + 0.5) / 7) * 100);
  });

  it('touching blocks share a lane (no split)', () => {
    const out = layoutWeek([
      item('a', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      item('b', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z'),
    ], [MON]);
    expect(out.get('a')).toMatchObject({ lane: 0, lanes: 1 });
    expect(out.get('b')).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('overlaps on different days do not split each other', () => {
    const days = dayColumns(MON, 2, 'UTC');
    const out = layoutWeek([
      item('a', '2026-01-05T09:00:00.000Z', '2026-01-05T11:00:00.000Z'),
      item('b', '2026-01-06T09:00:00.000Z', '2026-01-06T11:00:00.000Z'),
    ], days);
    expect(out.get('a')).toMatchObject({ dayIndex: 0, lanes: 1 });
    expect(out.get('b')).toMatchObject({ dayIndex: 1, lanes: 1 });
  });

  it('clips a block straddling the column boundary exactly like placeInDay', () => {
    const it1 = item('late', '2026-01-05T23:00:00.000Z', '2026-01-06T01:00:00.000Z');
    const out = layoutWeek([it1], dayColumns(MON, 2, 'UTC'));
    const pos = placeInDay(it1.startMs, it1.endMs, MON)!;
    expect(out.get('late')).toMatchObject({ dayIndex: 0, topPct: pos.topPct, heightPct: pos.heightPct });
    // The tail is drawn by no column (same rule as before the single layer).
    expect([...out.values()]).toHaveLength(1);
  });

  it('belongs to the column its START falls in, honouring a shifted day start', () => {
    const days = dayColumns(Date.parse('2026-01-05T12:00:00.000Z'), 3, 'UTC', 180); // 03:00 anchors
    const out = layoutWeek([item('n', '2026-01-07T01:00:00.000Z', '2026-01-07T02:00:00.000Z')], days);
    expect(out.get('n')!.dayIndex).toBe(1); // 01:00 on the 7th → the 6th's column
    expect(out.get('n')!.topPct).toBeCloseTo((22 * 60 / 1440) * 100);
  });

  it('leaves out items outside the rendered range', () => {
    const out = layoutWeek([
      item('before', '2026-01-04T09:00:00.000Z', '2026-01-04T10:00:00.000Z'),
      item('after', '2026-01-08T09:00:00.000Z', '2026-01-08T10:00:00.000Z'),
    ], dayColumns(MON, 3, 'UTC'));
    expect(out.size).toBe(0);
  });

  it('is empty for no days', () => {
    expect(layoutWeek([item('a', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z')], []).size).toBe(0);
  });

  it('skips a zero-length item (placeInDay has nothing to draw)', () => {
    const out = layoutWeek([{ key: 'z', startMs: MON + 9 * H, endMs: MON + 9 * H }], [MON]);
    expect(out.has('z')).toBe(false);
  });
});

describe('block horizontal css', () => {
  it('a lone block is inset 5px from both column edges', () => {
    expect(INSET_PX).toBe(5);
    expect(blockLeftCss(20, 0, 1)).toBe('calc(20% + 5px)');
    expect(blockWidthCss(10, 0, 1)).toBe('calc(10% - 10px)');
  });

  it('lanes keep the outer 5px inset and a 2px gap between neighbours', () => {
    expect(LANE_GAP_PX).toBe(2);
    // first lane: 5px left inset, 1px (half the gap) on its right
    expect(blockLeftCss(0, 0, 2)).toBe('calc(0% + 5px)');
    expect(blockWidthCss(50, 0, 2)).toBe('calc(50% - 6px)');
    // last lane: 1px on its left, 5px right inset
    expect(blockLeftCss(50, 1, 2)).toBe('calc(50% + 1px)');
    expect(blockWidthCss(50, 1, 2)).toBe('calc(50% - 6px)');
    // a middle lane has the half gap on both sides
    expect(blockLeftCss(33, 1, 3)).toBe('calc(33% + 1px)');
    expect(blockWidthCss(33, 1, 3)).toBe('calc(33% - 2px)');
  });
});
