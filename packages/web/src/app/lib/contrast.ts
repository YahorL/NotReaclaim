/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 0xff) + 0.7152 * lin((n >> 8) & 0xff) + 0.0722 * lin(n & 0xff);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours (1–21, order-independent). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The light theme's text-1 (#111214): the dark ink for marks on light fills. */
export const DARK_INK = '#111214';

/**
 * Ink for a check mark drawn on a solid swatch: white wherever it reaches the 3:1 non-text floor
 * (WCAG 1.4.11), else the dark ink — white on Amber / Cyan was ~1.9–2.6:1.
 */
export function checkInkOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= 3 ? '#ffffff' : DARK_INK;
}
