import { MS_PER_DAY, placeInDay } from './weekModel';
import { layoutOverlaps, type LayoutItem } from './overlapLayout';

/** Gap between a block and its day column's edges (prototype `.ev { left: 5px; right: 5px }`). */
export const INSET_PX = 5;
/** Gap between two side-by-side overlap lanes. */
export const LANE_GAP_PX = 2;

export interface BlockGeometry {
  /** Which rendered day column the block belongs to (its START falls in it). */
  dayIndex: number;
  /** Vertical position within the 24h column, in percent of the layer height. */
  topPct: number;
  heightPct: number;
  /** Horizontal position of the block's lane, in percent of the whole block layer (all N days). */
  leftPct: number;
  widthPct: number;
  lane: number;
  lanes: number;
}

/**
 * Geometry of every item in ONE absolutely-positioned layer spanning all `days` columns.
 *
 * Per day this is exactly the per-column rule the grid always had: an item belongs to the column
 * its start falls in (`[d, d + 24h)`), is placed and clipped by `placeInDay`, and splits into
 * equal lanes with the items it overlaps (`layoutOverlaps`). Only the horizontal frame changes:
 * `left = (dayIndex + lane/lanes) / N`, `width = 1 / (lanes · N)` of the layer.
 */
export function layoutWeek(items: readonly LayoutItem[], days: readonly number[]): Map<string, BlockGeometry> {
  const out = new Map<string, BlockGeometry>();
  const n = days.length;
  days.forEach((d, dayIndex) => {
    const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
    if (dayItems.length === 0) return;
    const lanes = layoutOverlaps(dayItems);
    for (const it of dayItems) {
      const pos = placeInDay(it.startMs, it.endMs, d);
      if (!pos) continue;
      const ln = lanes.get(it.key) ?? { lane: 0, lanes: 1 };
      out.set(it.key, {
        dayIndex,
        topPct: pos.topPct,
        heightPct: pos.heightPct,
        leftPct: ((dayIndex + ln.lane / ln.lanes) / n) * 100,
        widthPct: (1 / (ln.lanes * n)) * 100,
        lane: ln.lane,
        lanes: ln.lanes,
      });
    }
  });
  return out;
}

/** Pixel inset on a lane's left / right side: the column edge gets INSET_PX, a lane neighbour half the gap. */
function insets(lane: number, lanes: number): { left: number; right: number } {
  const half = LANE_GAP_PX / 2;
  return { left: lane === 0 ? INSET_PX : half, right: lane === lanes - 1 ? INSET_PX : half };
}

/** CSS `left` for a block whose lane starts at `leftPct` of the layer. */
export function blockLeftCss(leftPct: number, lane: number, lanes: number): string {
  return `calc(${leftPct}% + ${insets(lane, lanes).left}px)`;
}

/** CSS `width` for a block whose lane is `widthPct` of the layer wide. */
export function blockWidthCss(widthPct: number, lane: number, lanes: number): string {
  const i = insets(lane, lanes);
  return `calc(${widthPct}% - ${i.left + i.right}px)`;
}
