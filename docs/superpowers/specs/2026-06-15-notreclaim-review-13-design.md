# NotReclaim — Review 13: Planner layout & Start relocation (design)

Date: 2026-06-15

## Goals

Four planner UX fixes (all web except one small server tweak):

1. The per-tile **Start** button is unusable on short blocks. Move Start to a single,
   always-reachable place — the Next-task topbar widget — targeting the upcoming task.
   Pressing it pulls that task's start to the current time (snapped to 15 min).
2. Add a button to **hide/show the left sidebar**.
3. Add a button to **hide/show the right Priorities/Tasks panel**.
4. When all 7 days don't fit, render **as many days as fit (no horizontal scroll)** —
   a today-anchored window that pages by the visible count.

## Non-goals

- No change to how spent/left is computed or to the manual/auto modes (Review 12 work stands).
- No new persistence beyond two small `localStorage` UI flags.
- No drag-to-start; Start remains a single click in the widget.

---

## 1. Start — only in the Next-task widget

### UI
- **`InteractiveBlock`**: remove the `onStart` and `startedAt` props and the
  `block-start` / `block-started` rendering added in Review 12. Tiles no longer carry a
  Start affordance. (A started block is pinned, so the existing 🔒 already signals it.)
- **`WeekGrid`**: remove the `onStartBlock` prop, the `startedAt` field on `Item`, its
  assignment in `toItems`, and the `onStart`/`startedAt` passed to `InteractiveBlock`.
- **`Planner`**: remove `useStartBlockMutation` and the `onStartBlock` wiring to `WeekGrid`.
- **`TopBar` (Next-task widget)**: unchanged — it already renders the only Start button
  (`next-task-start`), calling `useStartBlockMutation` on the next strictly-future task
  block. Keep its `next-task-started` branch (harmless).

### Server — `POST /schedule/:id/start` (pull the start to now)
Change the snap so Start always moves the block's start to the snapped current time
(keeping the end), instead of only trimming a late start:

```ts
const now = deps.now();
const snapped = round15(now);
const data: { pinned: boolean; startedAt: Date; startsAt?: Date } = { pinned: true, startedAt: new Date(now) };
if (snapped < blockRow.endsAt.getTime()) data.startsAt = new Date(snapped); // pull start to now; keep end
```

So an upcoming block at 15:00–16:00 started at 14:07 becomes 14:00–16:00 (start pulled
to the snapped now, end fixed — the block stretches). The 404 (unknown) / 400 (no
`taskId`) guards are unchanged. Update the existing "does not move when snap is at/before
start" test to assert the new pull-forward behavior.

---

## 2. Hide / show the left sidebar

- **`AppShell`** owns `sidebarHidden` state, initialized from `localStorage["nr.sidebarHidden"]`
  and written back on change. It conditionally renders `<Sidebar/>` and passes
  `sidebarHidden` + `onToggleSidebar` to `TopBar`.
- **`TopBar`** renders a toggle button at its far left (`Icons.panelLeft`,
  `data-testid="toggle-sidebar"`, `aria-label` = "Hide sidebar" / "Show sidebar").

When hidden, `<Sidebar/>` is not rendered (the `main` column takes the full width via the
existing `flex-1`), which also widens the planner grid (feeds #4).

---

## 3. Hide / show the right Priorities/Tasks panel

- **`Planner`** owns `panelHidden` state from `localStorage["nr.plannerPanelHidden"]`.
- **`PlannerTaskPanel`** gets an `onHide` prop and a hide button in its tab header
  (`data-testid="panel-hide"`, `aria-label="Hide tasks panel"`, a `›` glyph).
- When `panelHidden`, `Planner` renders the panel-less layout plus a slim reopen button
  (`data-testid="panel-show"`, `aria-label="Show tasks panel"`, "Tasks ‹") at the right
  edge that sets `panelHidden=false`.

Hiding the panel widens the grid (feeds #4).

---

## 4. Responsive day window (no horizontal scroll)

### Model (`weekModel.ts`)
- Generalize `dayColumns(startMs, count = 7)` to return `count` consecutive local-midnight
  days (default 7 keeps existing callers/tests working).
- Generalize `clampDayDelta(dayIndex, delta, lastIndex = 6)` so cross-day drag clamps to
  the rendered column count.
- Add a pure `daysThatFit(widthPx)`:
  ```ts
  export const TIME_GUTTER_PX = 64;
  export const MIN_DAY_COL_PX = 120;
  export function daysThatFit(widthPx: number): number {
    if (!(widthPx > 0)) return 7; // unknown/SSR/jsdom → full week
    return Math.max(1, Math.min(7, Math.floor((widthPx - TIME_GUTTER_PX) / MIN_DAY_COL_PX)));
  }
  ```

### Planner
- Replace `weekStartMs` with `viewStartMs`, default `localMidnight(now())` (today is the
  leftmost column).
- A `ResizeObserver` on the grid container (`useElementWidth(ref)`) yields its width;
  `dayCount = daysThatFit(width)`; `days = dayColumns(viewStartMs, dayCount)`.
- Range queries use the visible span: `from = viewStartMs`, `to = viewStartMs + dayCount*MS_PER_DAY`.
- Nav: **Prev** `setViewStartMs(shiftDays(viewStartMs, -dayCount))`; **Next** `+dayCount`;
  **Today** `setViewStartMs(localMidnight(now()))`. Label shows the visible range.

### WeekGrid
- Render columns from `days` of arbitrary length:
  - `style={{ gridTemplateColumns: \`${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0,1fr))\` }}`
    on the header and body grids (replacing the hard-coded `grid-cols-[64px_repeat(7,1fr)]`).
  - **Remove `min-w-[820px]` and the `overflow-x-auto` wrapper** so the grid fills its
    container with no horizontal scroll.
- Accept a `dayCount` prop and pass `lastIndex = dayCount - 1` (or `dayCount`) down to
  `InteractiveBlock` for `clampDayDelta`. `DAY_LABELS` already covers 7; index `i` maps
  the same way for the first `count` days.

### InteractiveBlock
- Accept the column count (e.g. `dayCount`) and call
  `clampDayDelta(dayIndex, rawDelta, dayCount - 1)` so cross-day drag stays in range.

jsdom has no layout (width 0) → `daysThatFit` returns 7, so component tests and the
existing 7-day behavior are unchanged; the responsive count is verified live.

---

## Files touched

- `packages/server/src/schedule-routes.ts` — pull-forward snap in `POST /schedule/:id/start`.
- `packages/web/src/app/planner/weekModel.ts` — `dayColumns(count)`, `clampDayDelta(last)`, `daysThatFit`.
- `packages/web/src/app/planner/InteractiveBlock.tsx` — drop Start button + props; take `dayCount` for clamp.
- `packages/web/src/app/planner/WeekGrid.tsx` — dynamic columns, no min-width/scroll, drop `onStartBlock`/`startedAt`, take `dayCount`.
- `packages/web/src/app/pages/Planner.tsx` — `viewStartMs` + responsive `dayCount` + panel hide; drop start wiring.
- `packages/web/src/app/planner/PlannerTaskPanel.tsx` — `onHide` + hide button.
- `packages/web/src/app/AppShell.tsx` — `sidebarHidden` + conditional `<Sidebar/>`.
- `packages/web/src/app/shell/TopBar.tsx` — sidebar toggle button.
- New: `packages/web/src/app/planner/useElementWidth.ts` — ResizeObserver width hook.

## Testing

- **Pure (`weekModel`)**: `dayColumns(start, n)` returns n days; `clampDayDelta(idx, delta, last)`
  clamps to `[-idx, last-idx]`; `daysThatFit` (0→7, narrow→fewer, wide→7).
- **`WeekGrid`**: given `days` of length N (+ `dayCount=N`), renders N `day-col-*` columns and
  N `day-header-*`; the root has no `overflow-x-auto`/`min-w` class.
- **`AppShell`**: clicking `toggle-sidebar` removes/re-adds the sidebar; flag persists to localStorage.
- **`Planner`**: clicking `panel-hide` hides `planner-task-panel` and shows `panel-show`, and back;
  Prev/Next shift the visible days by `dayCount` (jsdom → 7); Today resets to today.
- **`InteractiveBlock`**: remove the Review 12 `block-start`/`block-started` tests.
- **`TopBar`**: existing `next-task-start` test stays (Start still targets the upcoming task).
- **Server**: update the start-route test — starting an upcoming block now pulls its start to
  `round15(now)` with the end unchanged; 404/400 guards unchanged.
- Tests per-package; web with `TZ=UTC`. Live-verify the responsive day count and both hides via geckodriver.

## Edge cases

- `daysThatFit` floors to ≥1 (never 0 columns) and caps at 7.
- Pulling an upcoming block's start to `round15(now)` keeps `start < end` (the block is
  future, so `now < start < end`); if `round15(now) >= endsAt` (shouldn't happen for a
  future block) the start isn't moved.
- Paging by `dayCount` while `dayCount` changes on resize is fine — `viewStartMs` is the
  anchor; the visible window simply grows/shrinks from it.
- Both hide flags default to **shown** when no localStorage value exists.
