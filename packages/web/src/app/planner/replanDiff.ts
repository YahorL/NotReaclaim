/**
 * Which blocks a user-initiated Re-plan newly placed (spec D13 / §5.5), so they can drop in.
 *
 * The server applies a replan as an in-place diff keyed by engine key: a block that survives
 * keeps its id (and just glides to its new time), so "new" is simply "an id we did not have
 * before the click". Pure — the Planner owns the snapshot and the timing.
 */

/** Gap between consecutive drop-ins (prototype: 180ms). */
export const DROP_STAGGER_MS = 180;
/** `animate-land` length (tailwind.config: land .9s). */
export const LAND_MS = 900;

interface BlockLike { id: string; startsAt: string }

/** Ids in `after` that were not in `before`, optionally limited to blocks starting in [fromMs, toMs). */
export function newBlockIds(before: ReadonlySet<string>, after: readonly BlockLike[], range?: { fromMs: number; toMs: number }): Set<string> {
  const out = new Set<string>();
  for (const b of after) {
    if (before.has(b.id)) continue;
    if (range) {
      const s = Date.parse(b.startsAt);
      if (!(s >= range.fromMs && s < range.toMs)) continue;
    }
    out.add(b.id);
  }
  return out;
}

/** Animation delay per new id: staggered by start time (earliest first), ties by id. */
export function dropInDelays(ids: ReadonlySet<string>, blocks: readonly BlockLike[]): Map<string, number> {
  const fresh = blocks
    .filter((b) => ids.has(b.id))
    .sort((a, b) => (Date.parse(a.startsAt) - Date.parse(b.startsAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(fresh.map((b, i) => [b.id, i * DROP_STAGGER_MS]));
}

/** When the last drop-in has finished. */
export function dropInDuration(delays: ReadonlyMap<string, number>): number {
  let max = -1;
  for (const d of delays.values()) max = Math.max(max, d);
  return max < 0 ? 0 : max + LAND_MS;
}
