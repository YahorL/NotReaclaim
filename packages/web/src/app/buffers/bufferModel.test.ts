import { describe, it, expect } from 'vitest';
import { stepBuffer, bufferPreview, BUFFER_STEP_MIN } from './bufferModel';

describe('stepBuffer', () => {
  it('steps by 5 minutes', () => {
    expect(BUFFER_STEP_MIN).toBe(5);
    expect(stepBuffer(10, 1)).toBe(15);
    expect(stepBuffer(10, -1)).toBe(5);
  });

  it('snaps an off-grid value to the next multiple of 5 in the stepped direction', () => {
    expect(stepBuffer(7, 1)).toBe(10);
    expect(stepBuffer(7, -1)).toBe(5);
    expect(stepBuffer(3, -1)).toBe(0);
  });

  it('floors at 0 and has no upper clamp', () => {
    expect(stepBuffer(0, -1)).toBe(0);
    expect(stepBuffer(60, 1)).toBe(65);
    expect(stepBuffer(240, 1)).toBe(245);
  });

  it('treats an invalid value (negative, NaN) as 0, and snaps a fractional one', () => {
    expect(stepBuffer(-5, 1)).toBe(5);
    expect(stepBuffer(-5, -1)).toBe(0);
    expect(stepBuffer(Number.NaN, 1)).toBe(5);
    expect(stepBuffer(Number.NaN, -1)).toBe(0);
    expect(stepBuffer(2.5, 1)).toBe(5);
  });
});

describe('bufferPreview', () => {
  const widths = (m: number, g: number) => bufferPreview(m, g).map((s) => [s.kind, Math.round(s.pct * 10) / 10]);

  it('lays out buffer · meeting · buffer · task · gap · task proportionally to their minutes', () => {
    // 10 + 60 + 10 + 30 + 10 + 30 = 150 minutes
    expect(widths(10, 10)).toEqual([
      ['buffer', 6.7], ['meeting', 40], ['buffer', 6.7], ['task', 20], ['gap', 6.7], ['task', 20],
    ]);
  });

  it('widths always sum to 100%, however large the buffers get', () => {
    for (const [m, g] of [[0, 0], [5, 0], [120, 600], [10_000, 3]]) {
      const total = bufferPreview(m!, g!).reduce((a, s) => a + s.pct, 0);
      expect(total).toBeCloseTo(100, 6);
    }
  });

  it('a zero buffer has zero width (hidden), and the gap keeps its slot at 0', () => {
    const segs = bufferPreview(0, 0);
    expect(segs.filter((s) => s.kind === 'buffer').map((s) => s.pct)).toEqual([0, 0]);
    expect(segs.find((s) => s.kind === 'gap')!.pct).toBe(0);
  });

  it('negative or NaN minutes count as 0', () => {
    expect(widths(-10, Number.NaN)).toEqual(widths(0, 0));
  });
});
