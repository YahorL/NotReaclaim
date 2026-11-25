import { describe, it, expect } from 'vitest';
import { contrastRatio, checkInkOn, DARK_INK } from './contrast';

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself, in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4285f4', '#4285f4')).toBeCloseTo(1, 5);
  });
});

describe('checkInkOn', () => {
  it('keeps a white check where white reaches the 3:1 non-text floor', () => {
    for (const hex of ['#5b62e3', '#4285f4', '#0f9d58', '#db4437', '#9c27b0', '#795548']) {
      expect(checkInkOn(hex)).toBe('#ffffff');
      expect(contrastRatio(hex, '#ffffff')).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses the dark ink on light swatches (Amber, Cyan), and that ink reaches 3:1', () => {
    for (const hex of ['#f4b400', '#00acc1']) {
      expect(contrastRatio(hex, '#ffffff')).toBeLessThan(3);
      expect(checkInkOn(hex)).toBe(DARK_INK);
      expect(contrastRatio(hex, DARK_INK)).toBeGreaterThanOrEqual(3);
    }
  });
});
