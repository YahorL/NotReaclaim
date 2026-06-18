# NotReclaim — Review 15: Full-day planner with vertical scroll (design)

Date: 2026-06-18

## Goal

Show the planner's full day (12:00 am – 11:59 pm) instead of the fixed 06:00–22:00
window, and make the hour grid **scroll vertically** so every hour is reachable. On
load, auto-scroll to the current time.

## User-confirmed behaviour

- The planner day spans the **full 24 hours** (00:00–24:00). Blocks/events at any hour
  render (currently anything outside 06:00–22:00 is clipped).
- The hour grid **scrolls vertically**; the **day-of-week header stays visible** while
  scrolling. (Horizontal behaviour — the Review 13 responsive day count, no horizontal
  scroll — is unchanged.)
- On load the grid **auto-scrolls to the current time** (now-line near the top, a little
  context above).

## Non-goals

- No change to scheduling (the engine still places work inside the user's working hours;
  this only widens the *display* window).
- The window is a fixed full day — not configurable, not derived from working hours.
- No visual shading of "working hours" within the 24h grid (flat grid).

## 1. Full-day window (`weekModel.ts`)

Change the two constants; everything else is derived and cascades:

```ts
export const WINDOW_START_MIN = 0;          // 00:00
export const WINDOW_END_MIN = 24 * 60;      // 24:00 (1440)
```

Downstream (no other edits needed in `weekModel.ts` — they already compute from the
constants): `placeInDay` (clamp + top/height %), `nowLine`, `GRID_COLUMN_PX`
(`= 24/… → 24*58 = 1392`), `pxToMinutes`/`minutesToPx` (drag/resize px↔min),
`snapClickToSlot` (`min(WINDOW_END_MIN-15, max(WINDOW_START_MIN, …))`), `clampToWindow`.

Effect: a block at e.g. 05:00 or 23:00 now returns a position from `placeInDay` instead
of `null`; the now-line shows at any hour.

## 2. Scrollable grid with a pinned day header (`WeekGrid.tsx`)

- `HOURS` becomes all 24 rows: `Array.from({ length: 24 }, (_, i) => i)` (00:00…23:00
  starts). `hourLabel` already renders `12a … 11p` for `0..23`.
- Keep the **day-of-week header grid fixed** (it stays where it is, above the scroll
  area). Wrap **only the body grid** (the hour gutter + day columns) in a vertical scroll
  container:
  ```tsx
  <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>
    {/* existing body grid: <div className="grid" style={{ gridTemplateColumns: gridCols }}> … </div> */}
  </div>
  ```
  The header grid and body grid share `gridCols`, so columns stay aligned while only the
  body scrolls. The `maxHeight` offset (~230px: top bar + planner padding + nav row +
  day-header row) is tuned during live verification so the planner fits the viewport with
  no page-level scrollbar.
- The day-column heights are unchanged in structure — 24 hour rows × `h-[58px]` = 1392px,
  so absolutely-positioned blocks (top%/height% of the column) still line up.

## 3. Auto-scroll to the current time (`WeekGrid.tsx`)

A `scrollRef` on the scroll container + a mount effect:

```ts
const scrollRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  const minOfDay = Math.max(0, Math.min(WINDOW_END_MIN, (nowMs - localMidnight(nowMs)) / 60000));
  el.scrollTop = Math.max(0, (minOfDay / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX - 64);
}, []); // run once on mount
```

Positions by time-of-day, so it works for any day/week in view. ~64px (~1h at 58px/hr)
of context sits above the now-line. In jsdom there's no layout/scroll, so this is a
harmless no-op in tests. (`localMidnight`, `GRID_COLUMN_PX`, `WINDOW_*` imported from
`weekModel`.)

## Files touched

- `packages/web/src/app/planner/weekModel.ts` — the two window constants.
- `packages/web/src/app/planner/WeekGrid.tsx` — 24-hour `HOURS`, scroll container +
  `scrollRef`, auto-scroll effect (import `useRef`/`useEffect`, `localMidnight`,
  `GRID_COLUMN_PX`).

(`InteractiveBlock.tsx`, `CreatePopover.tsx`, `Planner.tsx` consume the constants and need
no edits.)

## Testing

- **`weekModel.test.ts`**: update window-dependent expectations to 00:00–24:00 —
  `placeInDay` top/height now use a 1440-min span (e.g. a 09:00–10:00 block on a UTC day:
  `topPct = (540/1440)*100 = 37.5`, `heightPct = (60/1440)*100 = 4.166…`); add a case that
  a 05:00 (or 23:00) block now **places** (non-null) where it used to clip; `nowLine`
  returns a value across the full day; `snapClickToSlot(0)` → `WINDOW_START_MIN` (0) and
  `snapClickToSlot(1)` → `WINDOW_END_MIN-15` (1425); `clampToWindow` keeps within [0,1440].
- **`WeekGrid.test.tsx`**: the jsdom "click at 0-height column → window-top slot" now
  yields **00:00** (was 06:00); assert 24 hour rows render if it checks the count; the
  header row is outside the new scroll container (still found by `day-header-*`).
- **`Planner.test.tsx`**: the drag-to-schedule expectation `startsAt`/`endsAt` becomes the
  **00:00** window-top slot (was 06:00) — i.e. `2026-01-07T00:00:00.000Z` →
  `…T01:00:00.000Z` (duration 1h from the helper).
- **`CreatePopover.test.tsx`** + **`InteractiveBlock.test.tsx`**: update any assertion tied
  to the 06:00 window or the old `GRID_COLUMN_PX` (928 → 1392); drag tests that use the
  `pxToMinutes`/`minutesToPx` helpers cascade and need no change.
- Tests per-package; web with `TZ=UTC`. Live-verify via geckodriver: the grid shows 24
  hourly rows, scrolls vertically, lands near the current time on load, the day header
  stays fixed while scrolling, and a late-night (e.g. 23:00) block renders.

## Edge cases

- `localMidnight(nowMs)` gives the correct minute-of-day for the auto-scroll regardless of
  timezone (local arithmetic).
- A page-level scrollbar should not appear in addition to the grid's: the scroll
  container's `maxHeight` is sized to the viewport; tune the offset during live verify.
- `snapClickToSlot` still reserves a 15-min slot at the bottom (`WINDOW_END_MIN - 15` =
  23:45), so a click at the very bottom creates a 23:45 slot, not past midnight.
