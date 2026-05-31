# NotReclaim Web — Planner Proposed-Schedule Overlay — Design Spec

**Date:** 2026-05-30
**Status:** Approved (ready for implementation planning)
**Parent:** `docs/superpowers/specs/2026-05-30-notreclaim-planner-weekview-design.md` (5b)
**Depends on:** Milestones 1–5d (all merged).

## Summary

A follow-on enhancement to the Planner week-view: draw the scheduling engine's **proposed**
blocks (from `GET /schedule/preview`, already fetched for the At-risk panel) on the grid as
distinct **"ghost" blocks**, behind a toolbar **toggle (default on)**. Today the grid renders
only *persisted* `ScheduledBlock`s (from `GET /schedule`), which are written during a
Google-connected *reconcile*; running without Google credentials, reconcile returns `409
google_not_connected`, so the committed grid stays empty even though the engine works. This
overlay lets a user **see the auto-scheduler's output** without a Google connection — and, in
a connected setup, compare committed vs proposed. (5b deliberately deferred drawing preview
blocks; this adds it.)

## Goals

- Render `preview.blocks` (the engine's proposed placements) on the Planner grid, visually
  distinct from committed blocks (dashed/translucent ghost in the task/habit hue).
- A "Proposed" toggle in the Planner toolbar (default on) to show/hide the overlay.
- No backend change, no new query (the preview is already fetched). No Google needed.
- Deterministic tests (jsdom, fakes, `TZ=UTC`); build typechecks tests.

## Non-Goals

De-duplicating proposed vs committed blocks (both may show; out of scope). Editing/accepting
proposed blocks (read-only overlay). Any change to `/schedule/preview` or the engine. Showing
proposed blocks anywhere but the week grid.

## Decisions (locked during brainstorming)

- **Toggle, default on.** A toolbar toggle controls overlay visibility; the toggle state lives
  **locally in `WeekGrid`** (`useState(true)`) — the Planner page only passes the proposed
  blocks. Meetings are never "proposed."
- **Ghost styling:** dashed border + translucent fill in the same hue as the source kind
  (task = blue, habit = green), darker hue text (not white, since translucent), so committed
  (solid, white text) vs proposed (dashed, translucent) is obvious.
- **Coexistence:** committed (solid) and proposed (ghost) share the column layer; no dedup.

## Components

### `app/planner/EventBlock.tsx`
Add an optional `proposed?: boolean` prop (default `false`) + a `data-proposed` attribute.
- `proposed === false` → unchanged: `KIND_BG[kind]` solid fill, white text, optional pinned
  amber bar.
- `proposed === true` → ghost: a per-kind dashed/translucent style, e.g.
  `task → 'border border-dashed border-blue-400 bg-blue-500/20 text-blue-800'`,
  `habit → 'border border-dashed border-green-400 bg-green-500/20 text-green-800'`
  (a `KIND_PROPOSED` record parallel to `KIND_BG`). `pinned` is ignored for proposed (preview
  blocks have no pinned concept).

### `app/planner/WeekGrid.tsx`
- New prop `proposed: PreviewBlock[]` (from `../../api/types`).
- Local `const [showProposed, setShowProposed] = useState(true)`.
- The `Item` interface gains `proposed: boolean`. `toItems` is extended to map proposed blocks
  → `Item` (`key: 'p:'+id`, `title`, `kind: sourceType`, `pinned: false`, `proposed: true`,
  `startMs: block.start`, `endMs: block.end`, `startLabel: timeLabel(block.start)`). Proposed
  items are included **only when `showProposed`** is true. (Committed blocks/meetings unchanged,
  `proposed: false`.)
- A **"Proposed" toggle button** in the toolbar (`data-testid="toggle-proposed"`,
  `aria-pressed={showProposed}`, active-styled like the Tasks status tabs) → toggles
  `showProposed`.
- Each rendered `EventBlock` receives `proposed={it.proposed}`.

### `app/pages/Planner.tsx`
One line: pass `proposed={preview.data?.blocks ?? []}` to `<WeekGrid>`. (`preview` from the
existing `useSchedulePreviewQuery()`.) No other change; loading/error/empty branches unchanged.

## Data flow

`useSchedulePreviewQuery()` (already mounted) → `preview.data.blocks: PreviewBlock[]` (numeric
`start`/`end` epoch ms, `sourceType`, `title`) → `Planner` passes to `WeekGrid` → `toItems`
maps to proposed `Item`s → `placeInDay(start, end, dayStart)` (already ms; no `Date.parse`) →
`EventBlock proposed`. The toggle gates inclusion.

## Error handling

None new. If the preview query errors, `Planner` already shows its error strip; `proposed`
defaults to `[]` so the grid simply shows no ghosts.

## Testing (jsdom; fakes; `TZ=UTC`)

- **`EventBlock`:** a `proposed` block has `data-proposed="true"` and a dashed-border class
  (e.g. `border-dashed`); a committed block has `data-proposed="false"` and the solid `KIND_BG`
  class. Both still expose `data-kind`.
- **`WeekGrid`:** given `proposed` blocks (+ `showProposed` default on), proposed `EventBlock`s
  (`data-proposed="true"`) render in the correct day columns; clicking the **"Proposed"**
  toggle hides them while committed blocks (`data-proposed="false"`) remain; toggling again
  restores them.
- **`Planner` integration** (`renderWithProviders` + `fakeApiClient`): a preview fixture whose
  `blocks` fall in the visible week renders proposed ghosts on the grid by default; the toggle
  hides them. (Reuses the established cross-query timing pattern.)
- Build/typecheck clean.

## Scope

Small and cohesive — one plan, ~3 TDD tasks (EventBlock proposed variant → WeekGrid proposed
rendering + toggle → Planner wiring + integration test). The dev-proxy fix
(`vite.config.ts` `/auth` → `/auth/google`) is committed alongside (already applied).
