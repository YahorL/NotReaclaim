import { describe, it, expect } from 'vitest';
import { layoutOverlaps } from './overlapLayout';

const at = (h: number, m = 0) => Date.parse(`2026-01-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
const item = (key: string, sh: number, eh: number) => ({ key, startMs: at(sh), endMs: at(eh) });

describe('layoutOverlaps', () => {
  it('gives non-overlapping items a single full-width lane', () => {
    const m = layoutOverlaps([item('a', 9, 10), item('b', 10, 11), item('c', 11, 12)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('b')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('c')).toEqual({ lane: 0, lanes: 1 });
  });
  it('splits two overlapping items into two lanes', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 10, 12)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
  });
  it('uses three lanes for three mutually-overlapping items', () => {
    const m = layoutOverlaps([item('a', 9, 12), item('b', 9, 12), item('c', 9, 12)]);
    expect(m.get('c')).toEqual({ lane: 2, lanes: 3 });
  });
  it('reuses a freed lane within the same cluster (A 9-11, B 9-10, C 10-11)', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 9, 10), item('c', 10, 11)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(m.get('c')).toEqual({ lane: 1, lanes: 2 }); // C reuses B's lane (B ends as C starts)
  });
  it('treats touching blocks (end == start) as non-overlapping', () => {
    const m = layoutOverlaps([item('a', 9, 10), item('b', 10, 11)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('b')).toEqual({ lane: 0, lanes: 1 });
  });
  it('keeps separate clusters independent', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 10, 12), item('x', 14, 15)]);
    expect(m.get('a')!.lanes).toBe(2);
    expect(m.get('x')).toEqual({ lane: 0, lanes: 1 });
  });
});
