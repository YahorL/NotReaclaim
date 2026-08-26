import { describe, it, expect } from 'vitest';
import { edgeScrollStep, EDGE_ZONE_PX, MAX_EDGE_SCROLL_PX } from './edgeScroll';

const TOP = 100;
const BOTTOM = 700;

describe('edgeScrollStep', () => {
  it('exports tunable constants', () => {
    expect(EDGE_ZONE_PX).toBe(48);
    expect(MAX_EDGE_SCROLL_PX).toBe(14);
  });

  it('does nothing away from the edges', () => {
    expect(edgeScrollStep(400, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(TOP + EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(BOTTOM - EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
  });

  it('ramps up as the pointer nears the top edge', () => {
    const near = edgeScrollStep(TOP + 40, TOP, BOTTOM);
    const nearer = edgeScrollStep(TOP + 10, TOP, BOTTOM);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeScrollStep(TOP, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('clamps past the top edge instead of accelerating forever', () => {
    expect(edgeScrollStep(TOP - 500, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('ramps down as the pointer nears the bottom edge and clamps past it', () => {
    const near = edgeScrollStep(BOTTOM - 40, TOP, BOTTOM);
    expect(near).toBeGreaterThan(0);
    expect(edgeScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(near);
    expect(edgeScrollStep(BOTTOM, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
    expect(edgeScrollStep(BOTTOM + 500, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
  });

  it('is inert for a degenerate rect (jsdom measures everything as zero)', () => {
    expect(edgeScrollStep(0, 0, 0)).toBe(0);
    expect(edgeScrollStep(50, 100, 100)).toBe(0);
  });
});
