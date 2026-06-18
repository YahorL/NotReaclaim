# NotReclaim — Review 16b: Google-Calendar overlap layout (design)

Date: 2026-06-18

## Problem

Every planner tile is `absolute left-0.5 right-0.5` (full column width), so two tasks that
overlap in time render stacked on top of each other (the later one obscures the earlier).
We want concurrent tiles side-by-side in sub-columns, like Google Calendar.

## Goal

Within a day column, overlapping blocks/events render in equal-width side-by-side lanes
(per the approved "equal lanes" model): an overlap *cluster* of N maximally-concurrent items
splits into N lanes; every item in the cluster takes `1/N` of the width at its lane offset.

## Non-goals

- Not the "expand to fill" variant (an item widening into free space to its right) — explicitly
  deferred; equal lanes per cluster is the chosen model.
- No change to vertical placement, drag/resize, or the timezone work (16a).

## Algorithm — `packages/web/src/app/planner/overlapLayout.ts` (new, pure)

```ts
export interface LayoutItem { key: string; startMs: number; endMs: number }
export interface Lane { lane: number; lanes: number } // lane index, total lanes in the cluster

/** Assign each item a lane within its overlap cluster (equal-lane model). */
export function layoutOverlaps(items: LayoutItem[]): Map<string, Lane>
```

Logic:
1. Sort a copy by `startMs` asc, then `endMs` asc, then `key` (stable/deterministic).
2. Sweep, accumulating a **cluster** = a run of items where each new item overlaps at least one
   still-open lane. A new item *starts a fresh cluster* when its `startMs >= max(endMs)` of all
   items in the current cluster (no overlap with anything active).
3. Within a cluster, assign each item to the **first lane whose last item's `endMs <= item.startMs`**
   (touching counts as free — `end == start` is not an overlap); otherwise open a new lane.
4. When a cluster closes (or at the end), set every member's `lanes` to the cluster's lane count.
5. Return `Map<key, { lane, lanes }>`.

From a `Lane`: `leftPct = (lane / lanes) * 100`, `widthPct = (1 / lanes) * 100`.

## Rendering

- **`EventBlock.tsx`**: remove `left-0.5 right-0.5` from the shared `BASE` string; add
  `leftPct = 0`, `widthPct = 100` props; apply inline
  `style={{ left: \`calc(${leftPct}% + 2px)\`, width: \`calc(${widthPct}% - 4px)\`, … }}`
  (the `+2px / -4px` gives a 2px gutter each side — single-lane default reproduces today's
  `left-0.5 right-0.5` look).
- **`InteractiveBlock.tsx`**: same `leftPct`/`widthPct` props (default 0/100), merged into its
  existing inline `style` (which already sets `top`/`height`/`transform`/accent). Drag/resize is
  unchanged — cross-day `transform` still uses the full column width; only the rendered width narrows.
- **`WeekGrid.tsx`**: per day, `const lanes = layoutOverlaps(dayItems.map(it => ({ key: it.key, startMs: it.startMs, endMs: it.endMs })))`. For each rendered item, look up `lanes.get(it.key)` (default `{lane:0,lanes:1}`), compute `leftPct`/`widthPct`, and pass them to `InteractiveBlock`/`EventBlock`. Both meetings (events) and task blocks share the same lane computation so a meeting overlapping a task sits beside it.

## Testing

- **`overlapLayout.test.ts`**: non-overlapping run → every item `{lane:0, lanes:1}`; two overlapping
  → `{0,2}`/`{1,2}`; three mutually overlapping → `lanes:3`; the chained case A(9–11), B(9–10),
  C(10–11) → A`{0,2}`, B`{1,2}`, C`{1,2}` (C reuses B's lane since B ends as C starts; cluster width 2);
  touching blocks (`end==start`) share a lane; two separate clusters in a day are independent.
- **`WeekGrid.test.tsx`**: two overlapping blocks render at ~50% width (assert the inline `width`
  contains `50%`); a lone block stays full-width.
- **`EventBlock`/`InteractiveBlock`**: passing `leftPct=50,widthPct=50` yields the expected inline
  `left`/`width`; defaults keep full width.
- Tests per-package, web `TZ=UTC`. Live-verify via geckodriver: create two overlapping tasks in a
  day → they render side-by-side, each ~half width; non-overlapping tasks stay full width.

## Edge cases

- A day with no overlaps: every tile `{lane:0,lanes:1}` → full width (current look preserved).
- Zero-/short-duration blocks: handled by the `end<=start` lane-free check.
- The layout is order-stable (sorted by start/end/key) so tiles don't jump between renders.
