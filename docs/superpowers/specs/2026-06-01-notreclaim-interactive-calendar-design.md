# NotReclaim — Interactive Calendar (Review 1, Milestone B) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` item #3b — move & resize scheduled blocks; moving/resizing locks them.
**Builds on:** Milestone A (pinned blocks render green + 🔒; unpinned = movable dashed green).

## Summary

Let the user **drag-move** (vertically, within a day) and **resize** (bottom edge) committed
**task/habit** blocks on the Planner week-grid. On release the block's new start/end is persisted
and the block is **pinned (locked)** so the engine keeps it; the rest of the schedule **reflows**
around it. Adds a backend `PATCH /schedule/:id`, an ApiClient method + query mutation, pure inverse
geometry in `weekModel`, and a thin pointer-interaction wrapper in `WeekGrid`. Google meetings/events
are not interactive.

## Goals

- Drag a task/habit block's **body** up/down → change its time (same day), snapped to 15 min,
  clamped to 06:00–22:00.
- Drag a task/habit block's **bottom edge** → change its end/duration (15-min snap, clamped).
- On release: persist `{ startsAt, endsAt, pinned: true }`; the rest of the schedule reflows.
- Backend route + ApiClient + TanStack mutation; pure, tested geometry; deterministic tests.

## Non-Goals

- No cross-day move (dragging into another day column) — within-day vertical only (MVP).
- No top-edge resize (bottom edge only).
- Meetings/Google calendar events are read-only on the grid (not movable/resizable).
- No new engine behavior — pinned blocks are already honored by `assembleScheduleInput`
  (fixed + coverage) and skipped by `applyDesiredSchedule`'s keyed diff; reflow reuses the existing
  re-plan path. No DB migration (`pinned`/`startsAt`/`endsAt` already exist).

## Decisions (locked during brainstorming)

- **Within-day vertical move + bottom-edge resize, 15-min snap, clamp to the window.** (User
  declined to broaden; these are the lower-risk MVP defaults.)
- **Only committed task/habit blocks are interactive;** meetings/events render as today.
- **Move/resize sets `pinned: true`** → the block locks (green + 🔒) and survives re-plan.
- **Auto-reflow on drop:** after the PATCH, the route runs the existing after-mutation re-plan hook,
  so unpinned blocks reflow around the new pin and a `schedule.updated` WS fires.
- **Geometry lives in `weekModel`** (pure) — the inverse of `placeInDay`.

## Architecture / Components

### Backend — `@notreclaim/server`
- **`schemas.ts`:** a zod `updateScheduledBlockSchema` = `{ startsAt?: string.datetime(), endsAt?:
  string.datetime(), pinned?: boolean }`, refined so that when both are present `startsAt < endsAt`.
- **`schedule-routes.ts`:** add `PATCH /schedule/:id` (guarded). Parse `:id` (string) + body via the
  schema; call `deps.repos.scheduledBlocks.update(request.userId, id, { startsAt: new
  Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: body.pinned })` (only set the fields
  present). Return the updated block. A not-owned id → the repo's `NotFoundError` → existing error
  mapper → `404`. After a successful update, invoke the after-mutation hook (reflow + WS).
  - `registerScheduleRoutes(app, deps, afterMutation)` gains the `afterMutation` param (same hook
    the task/habit/settings routes already receive from `buildApp`); the PATCH handler calls
    `afterMutation(request.userId)` after the update so the rest of the schedule re-plans and
    `schedule.updated` is emitted.
- **`app.ts`:** widen `AppDeps.repos.scheduledBlocks` from `Pick<ScheduledBlockRepository,
  'listByUserInRange'>` to `Pick<…, 'listByUserInRange' | 'update'>`; pass `afterMutation` into
  `registerScheduleRoutes`. `server.ts` already wires the full `scheduledBlocks` repo — no change
  there beyond the type widening flowing through.

### Web — API layer
- **`api/types.ts`:** `interface UpdateScheduledBlockInput { startsAt?: string; endsAt?: string;
  pinned?: boolean }` (ISO strings).
- **`api/client.ts`:** `ApiClient.updateScheduledBlock(id: string, patch: UpdateScheduledBlockInput):
  Promise<ScheduledBlock>` → `request('PATCH', \`/schedule/${id}\`, patch)`. Add to the fake’s
  `notImplemented` base (so tests opt in).
- **`api/queries.ts`:** `useUpdateScheduledBlockMutation()` → `mutationFn ({ id, patch }) =>
  api.updateScheduledBlock(id, patch)`, `onSuccess` invalidates `queryKeys.scheduleRoot` (prefix —
  covers `/schedule` and `/schedule/preview`).

### Web — geometry (`app/planner/weekModel.ts`, pure)
The day column is a **fixed height by construction**: it renders one 58px row per hour of the
06:00–22:00 window, so `columnPx = (windowSpanMinutes / 60) * 58 = 16 * 58 = 928px` — a **known
constant, not a runtime measurement.** weekModel exports it so the grid rows and the drag math stay
in sync:
- `export const HOUR_ROW_PX = 58;` and `export const GRID_COLUMN_PX = ((WINDOW_END_MIN −
  WINDOW_START_MIN) / 60) * HOUR_ROW_PX;` (= 928). `WeekGrid` uses `HOUR_ROW_PX` for its row height
  (replacing the hardcoded `h-[58px]`/`length: 16`).
- `snapMinutes(min: number, step = 15): number` → nearest multiple of `step`.
- `pxToMinutes(px: number): number` → `(px / GRID_COLUMN_PX) * (WINDOW_END_MIN − WINDOW_START_MIN)`
  (a signed pixel delta → minute delta; the caller snaps).
- `clampToWindow(startMin: number, durationMin: number): { startMin: number; endMin: number }` →
  keep `[startMin, startMin+durationMin]` within `[WINDOW_START_MIN, WINDOW_END_MIN]` (shift start
  back if the end would overflow; floor start at the window start).
- The drag computes `deltaMin = snapMinutes(pxToMinutes(currentClientY − startClientY))`. New ISO
  time for the (unchanged) day: `new Date(dayStartMs + newStartMin * 60000).toISOString()` where
  `newStartMin` = the original start-minute-of-day +/- delta, run through `clampToWindow`.

### Web — interaction (`app/planner/`)
- A focused wrapper, e.g. **`InteractiveBlock.tsx`**, wraps an `EventBlock` for **task/habit** items
  and owns the pointer logic; `WeekGrid` renders meetings via plain `EventBlock` and task/habit via
  `InteractiveBlock`. Props: the item's `id`, day-start ms, original start/end ms, `topPct`/
  `heightPct`, `startLabel`/`title`/`kind`/`pinned`, and an `onCommit(patch)` callback. (No
  column-height prop — the conversion uses the `GRID_COLUMN_PX` constant + the pointer's `clientY`.)
  - **Move:** `pointerdown` on the body (not on the resize handle) → capture pointer, record start
    `clientY`; `pointermove` → live `dragOffsetPx = clientY − startClientY` (visual translate);
    `pointerup` → `deltaMin = snapMinutes(pxToMinutes(dragOffsetPx))`; `{ startMin } =
    clampToWindow(origStartMin + deltaMin, durationMin)`; `onCommit({ startsAt, endsAt, pinned: true })`.
  - **Resize:** a small bottom **handle** (`data-testid="resize-handle"`); `pointerdown` on it →
    resize mode; `pointermove` → live height preview; `pointerup` → `deltaMin` as above applied to
    the **end**; enforce a minimum duration (≥ 15 min); `onCommit({ startsAt (unchanged), endsAt,
    pinned: true })`.
  - Uses pointer capture (`setPointerCapture`) so the drag tracks outside the element; `pointerup`
    ends it. A tiny click-vs-drag threshold avoids treating a click as a 0-delta move (no-op commit
    when delta is 0).
- No measurement: the column is `GRID_COLUMN_PX` tall by construction. `onCommit` is wired by
  `WeekGrid` → `Planner` → `useUpdateScheduledBlockMutation`.
- `EventBlock` is unchanged (pure presentational); `data-testid="event-block"`/`data-kind`/
  `data-pinned` preserved. `InteractiveBlock` adds `data-testid="resize-handle"` on the handle.

## Data flow

`pointerup` → `onCommit({ id, startsAt, endsAt, pinned: true })` → `updateScheduledBlock` PATCH →
server updates the block + runs the after-mutation re-plan (unpinned blocks reflow) + emits
`schedule.updated` → web invalidates `scheduleRoot` → `/schedule` + `/schedule/preview` refetch →
the grid redraws (the block now green + 🔒 at its new time; others reflowed) and the At-risk panel
updates.

## Error handling

PATCH validation failure → `400` (zod via the error mapper); not-owned id → `404`. A failed mutation
surfaces via the existing Planner error affordance pattern (no crash; the optimistic drag preview is
cleared on settle and the grid reflects server state after invalidation). The route swallows
reflow-hook errors the same way `replanAfterMutation` already does (the update itself already
succeeded).

## Testing (vitest; `TZ=UTC`; no real Google; Postgres for db)

- **`weekModel` geometry (pure):** `snapMinutes` (rounding incl. .5 boundaries, custom step);
  `fractionToMinutes` (0→360, 1→1320, 0.5→840); `clampToWindow` (start floored at 360; end capped at
  1320 by shifting start back; exact-fit unchanged).
- **Server `PATCH /schedule/:id`:** updates startsAt/endsAt/pinned and returns the block; calls the
  after-mutation hook (assert a `schedule.updated`/reflow effect via the test harness's hook spy);
  `404` for another user's id; `400` when `startsAt >= endsAt`. (Extend `buildTestApp`'s
  `fakeScheduledBlockRepo` with an `update` that mutates the seed + the AppDeps repo-surface widening.)
- **ApiClient/query:** `updateScheduledBlock` issues `PATCH /schedule/:id`; the mutation invalidates
  `scheduleRoot`.
- **Interaction (`InteractiveBlock`):** drive the pointer `clientY` directly (no layout stub needed —
  the conversion uses the `GRID_COLUMN_PX` constant): fire `pointerdown`(body, clientY=Y0)→
  `pointermove`(clientY=Y1)→`pointerup` and assert `onCommit` is called with the expected
  snapped/clamped `{ startsAt, endsAt, pinned: true }` (choose Y1−Y0 so the px→min→snap result is a
  known value, e.g. a delta mapping to +60 min); same for `pointerdown`(resize-handle)→…→`pointerup`
  changing only `endsAt`; a zero-delta click commits nothing; a meeting renders no `resize-handle`
  and no move handlers. (`setPointerCapture` is a no-op stub in jsdom — guard the call so it doesn't
  throw, or call it only when present.)
- Full monorepo suite + web build green.

## Scope / decomposition (for the plan)

~4 TDD tasks, sequential:
1. **Backend:** zod schema + `PATCH /schedule/:id` + `AppDeps` repo-surface widen + `afterMutation`
   reflow wire + server tests (incl. `buildTestApp` `update` fake).
2. **Web API:** `UpdateScheduledBlockInput` type + `ApiClient.updateScheduledBlock` (+ fake) +
   `useUpdateScheduledBlockMutation` + tests.
3. **Geometry:** `HOUR_ROW_PX`/`GRID_COLUMN_PX` + `snapMinutes` / `pxToMinutes` / `clampToWindow` in
   `weekModel` + tests; `WeekGrid` uses `HOUR_ROW_PX` for its row height.
4. **Interaction:** `InteractiveBlock` (move + resize, pointer capture, click-vs-drag) + `WeekGrid`
   rendering task/habit via `InteractiveBlock` (meetings stay plain `EventBlock`) + `Planner` passing
   the mutation as `onCommit` + tests; then full verification.
