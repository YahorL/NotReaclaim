import { describe, it, expect } from 'vitest';
import {
  IDLE, beginPress, pressDistance, pressMove, pressArm, endPress, isArmed, isTap,
  LONG_PRESS_MS, LONG_PRESS_SLOP_PX,
} from './longPress';

describe('longPress', () => {
  it('exports tunable constants', () => {
    expect(LONG_PRESS_MS).toBe(350);
    expect(LONG_PRESS_SLOP_PX).toBe(8);
  });

  it('a non-deferred press (mouse) arms immediately', () => {
    const s = beginPress(10, 20, false);
    expect(s.phase).toBe('armed');
    expect(isArmed(s)).toBe(true);
    expect(isTap(s)).toBe(false);
  });

  it('a deferred press (touch) starts pending and remembers its origin', () => {
    const s = beginPress(10, 20, true);
    expect(s.phase).toBe('pending');
    expect(isArmed(s)).toBe(false);
    expect(s.originX).toBe(10);
    expect(s.originY).toBe(20);
  });

  it('pressDistance is the euclidean travel from the origin', () => {
    const s = beginPress(10, 20, true);
    expect(pressDistance(s, 13, 24)).toBe(5);
    expect(pressDistance(s, 10, 20)).toBe(0);
  });

  it('a pending press survives movement inside the slop', () => {
    const s = beginPress(10, 20, true);
    expect(pressMove(s, 14, 20).phase).toBe('pending'); // 4px
    expect(pressMove(s, 10, 28).phase).toBe('pending'); // 8px, exactly the slop
  });

  it('a pending press beyond the slop cancels — that gesture is a scroll', () => {
    const s = beginPress(10, 20, true);
    expect(pressMove(s, 10, 30)).toEqual(IDLE); // 10px > 8px
    expect(pressMove(s, 10, 30, 20).phase).toBe('pending'); // slop is tunable
  });

  it('movement never disturbs an armed press', () => {
    const s = beginPress(10, 20, false);
    expect(pressMove(s, 400, 900)).toBe(s);
  });

  it('pressArm promotes only a pending press; isTap marks a release before arming', () => {
    expect(pressArm(beginPress(0, 0, true)).phase).toBe('armed');
    expect(pressArm(IDLE)).toBe(IDLE);
    expect(pressArm(beginPress(0, 0, false)).phase).toBe('armed');
    expect(isTap(beginPress(0, 0, true))).toBe(true);
    expect(isTap(beginPress(0, 0, false))).toBe(false);
    expect(isTap(IDLE)).toBe(false);
    expect(endPress()).toEqual(IDLE);
  });
});
