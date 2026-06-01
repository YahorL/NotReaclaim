# NotReclaim Web — Planner Polish (Review 1, Milestone A) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` items #2 (remove "Proposed") and #3a (Google-Calendar-style block
colors). Milestone A of a 6-item review, decomposed into sequenced milestones (B = interactive
move/resize; C = categories; D = schedule-after; E = buffers; F = subtasks/ordering — all later).

## Summary

Web-only Planner cleanup: remove the now-redundant **Proposed** overlay/toggle (committed blocks
persist locally as of the local-scheduling milestone), and restyle calendar blocks **by state**
like Google Calendar — meetings **blue**, locked (pinned) task/habit blocks **green + 🔒**, movable
(unpinned) task/habit blocks **transparent with a dashed green outline**. No engine/DB/server change.

## Goals

- Remove the proposed-overlay ghost rendering + the "Proposed" toggle from the Planner; keep the
  schedule-preview query feeding the At-risk panel + Stats.
- Restyle `EventBlock` by `(kind, pinned)`: meeting → solid blue; pinned task/habit → solid green +
  a 🔒 lock indicator; unpinned task/habit → transparent + dashed green border.
- Update the WeekGrid legend to the new **state-based** scheme.
- Deterministic tests (jsdom, `TZ=UTC`); build typechecks tests.

## Non-Goals

- No interactive move/resize and no pin/move endpoint (that is **Milestone B**).
- No engine, DB, server, `weekModel`, or schedule-data change.
- Task-vs-habit color distinction is intentionally dropped (the scheme is state-based; habits fold
  into the task styling). `data-kind` stays for tests/semantics.
- No change to `/schedule/preview` usage for `unscheduled` (At-risk) or Stats.

## Decisions (locked during brainstorming)

- **Color by state, not kind:**
  - **meeting / calendar event → solid blue, white text** (events are inherently fixed).
  - **task/habit pinned (locked) → solid green, white text, 🔒 before the title.**
  - **task/habit unpinned (movable) → transparent fill, dashed green border, dark-green text.**
- **Habits fold into the task scheme** (green when locked, green-dashed when movable).
- **Lock indicator = the 🔒 emoji** prepended to the title for pinned blocks.
- **Legend is state-based:** Meeting (blue) · Locked 🔒 (green) · Movable (green dashed).
- **Today everything renders movable** (nothing is pinned without Google drift / Milestone B's
  drag-to-lock) — this is correct (unpinned blocks can still move on re-plan).

## Architecture / Components

### Tokens — `tailwind.config.js`
Add a Google-style blue for events, e.g. `eventBlue: '#4285f4'` (+ optionally `eventBlueText`
if a darker variant is wanted; solid blue + white text needs only the one). Reuse the existing
green: `low` / `kind.habitBar` = `#2fa45f` (fill) and `kind.habitText` = `#1c7a43` (movable text).
All block classes are **literal strings** (JIT scanner).

### `app/planner/EventBlock.tsx`
- Drop the `proposed?` prop and the `KIND_PROPOSED` record.
- Props: `{ title, kind, topPct, heightPct, startLabel, pinned? }` (+ keep `data-testid="event-block"`,
  `data-kind`, `data-pinned`, the `top`/`height` % styles, and the `title` tooltip attribute).
- Variant by `(kind, pinned)`:
  - `kind === 'meeting'` → `bg-eventBlue text-white` (solid blue; `pinned` irrelevant).
  - `kind` is `task`/`habit` and `pinned` → `bg-low text-white` (solid green); render **🔒** before
    the start label/title (e.g. `🔒 {startLabel} {title}`).
  - `kind` is `task`/`habit` and not `pinned` → `bg-transparent border border-dashed border-low
    text-kind-habitText` (transparent, dashed green outline, dark-green text) = movable.
- Keep the base layout classes (`absolute left-0.5 right-0.5 overflow-hidden rounded-[6px]
  px-[7px] py-1 text-[12.5px] font-bold leading-tight`). The previous `border-l-[3px]` kind-bar /
  amber-pinned-bar styling is replaced by the state scheme above.

### `app/planner/WeekGrid.tsx`
- Remove: `useState`/`showProposed`, the `proposed?: PreviewBlock[]` prop, the `proposed`-block
  branch of `toItems` (the `fromProposed` mapping + the `Item.proposed` field), the **Proposed**
  toggle button (`data-testid="toggle-proposed"`), and the `EventBlock proposed={…}` prop.
- `toItems(blocks, events)` now maps only committed blocks (`classifyBlock` → kind/pinned) +
  calendar events (kind `meeting`). `Item` loses `proposed`.
- **Legend** → state-based: `Meeting` (solid `bg-eventBlue` swatch) · `Locked 🔒` (solid `bg-low`
  swatch) · `Movable` (a small `border border-dashed border-low` swatch). Keep the Re-plan button
  and nav/header/day-headers/now-line unchanged.

### `app/pages/Planner.tsx`
- Remove `committedKeys`/`proposedGhosts` (the dedupe `useMemo`s) and the `proposed=` prop on
  `<WeekGrid>`. Keep `useSchedulePreviewQuery` and `preview.data?.unscheduled ?? []` → `AtRiskPanel`.
  Everything else (schedule/calendar queries, replan, nav) unchanged.

## Data flow

`useScheduleQuery` → committed blocks → `WeekGrid` draws them by state (blue/green/green-dashed).
`useSchedulePreviewQuery` → `unscheduled` → `AtRiskPanel` (unchanged); its `blocks` are no longer
drawn on the grid. No new queries; no mutations changed.

## Error handling

Unchanged — Planner keeps its existing error strip + Retry and the "Re-plan failed" message.

## Testing (jsdom; `TZ=UTC`)

- **`EventBlock.test.tsx`:** meeting → className contains `bg-eventBlue` + `text-white`; pinned task
  (`pinned`) → `bg-low` + `text-white` + the rendered text contains `🔒` + `data-pinned="true"`;
  unpinned task → `border-dashed` + `border-low` + NOT `text-white` + `data-pinned="false"`;
  `data-kind` preserved; `top`/`height` % preserved. Remove the proposed-ghost tests.
- **`WeekGrid.test.tsx`:** remove the "renders proposed blocks…toggle hides them" test and any
  `toggle-proposed` reference. Keep: meeting+task placement by `data-kind`, `day-header-2`
  `data-today`, `now-line`, nav callbacks, `/re-plan/i`. (The `renderGrid` helper drops the
  `proposed` prop.)
- **`Planner.test.tsx`:** remove the proposed-overlay test and the committed-vs-proposed dedupe
  test; keep blocks/meetings/at-risk render, `/re-plan/i`, and next-week refetch.
- `weekModel.test` untouched. Build/typecheck clean; full monorepo suite green.

## Scope / decomposition (for the plan)

~2 TDD tasks, web-only:
1. **`EventBlock` restyle** (token + state-based variants + 🔒) + `EventBlock.test` update.
2. **`WeekGrid` + `Planner`**: remove Proposed (toggle/prop/dedupe/`toItems` branch), state-based
   legend; update `WeekGrid.test` + `Planner.test`; then full verification (web suite + build, then
   the other packages as a sanity pass).
