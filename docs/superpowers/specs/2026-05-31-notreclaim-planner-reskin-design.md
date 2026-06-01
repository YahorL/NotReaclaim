# NotReclaim Web — Planner Re-skin — Design Spec

**Date:** 2026-05-31
**Status:** Approved (ready for implementation planning)
**Parent:** Redesign Milestone 2 (follows M1 dark shell + Priorities board, merged `80bb972`).
**Design source:** `design_handoff_notreclaim/app/pages.jsx` (Planner) + README "Planner" section.

## Summary

A **purely visual** re-skin of the existing, working Planner week-view to the design handoff.
The Planner already renders committed schedule blocks, Google meetings, the proposed-overlay
ghost blocks (behind the default-on "Proposed" toggle), the at-risk panel, the now-line, week
navigation, and Re-plan. This milestone restyles the presentation to the handoff — kind-coloured
event blocks, a white calendar card with a 64px gutter + 58px/hour rows, day headers with the
current day in an indigo pill, and a right-aligned legend — **without changing any behavior or
the schedule data model**.

## Goals

- Restyle `EventBlock` to the handoff: a **tinted fill + dark-hue text + a 3px left bar** in the
  kind colour (replacing today's solid `bg-slate-400 text-white`), using the `kind.*` tokens
  already in `tailwind.config.js`.
- Restyle `WeekGrid`: header strip (prev/next square buttons, range label, "Today" pill, legend),
  a white calendar card (`rounded-[14px]`, `border-line`, `min-w-[820px]`, scrollable), a
  `64px + repeat(7,1fr)` grid with day-header pills, and a body of **fixed 58px/hour rows**.
- Keep our two non-handoff controls — the **Proposed toggle** and **Re-plan** button — styled to
  match.
- Preserve every behavior, `data-testid`, and data-attribute. `weekModel.ts` is **unchanged**.
- Deterministic tests (jsdom, fakes, `TZ=UTC`); build typechecks tests.

## Non-Goals

- No change to `weekModel.ts` (window stays **06:00–22:00**; `placeInDay` keeps returning
  top/height **percentages**). No change to data fetching, query keys, re-plan, the proposed
  overlay logic, the at-risk computation, or routing.
- No new block kind. The handoff's **"Focus" kind is dropped** (NotReclaim has no focus blocks).
- Not narrowing the visible window to the handoff's 8a–7p (that was its demo-data range);
  keeping 06:00–22:00 so no real early/late block is hidden.
- Stats dashboard (Redesign M3) remains out of scope.

## Decisions (locked during brainstorming)

- **Drop Focus.** Legend + palette show only the three kinds we render: **Meeting (red), Task
  (orange), Habit (green)**.
- **Keep the 06:00–22:00 window** (behavior-preserving); render it as 16 fixed **58px** hour rows
  → a tall, scrollable calendar (≈928px body) instead of the current compact 198px box.
- **`weekModel.ts` untouched** — re-skin lives entirely in `EventBlock` + `WeekGrid` (+ a light
  `AtRiskPanel` restyle). `placeInDay`/`nowLine`/`isToday` percentages still drive positioning.
- **Pinned cue preserved** as an **amber left bar** (overriding the kind bar); `data-pinned` stays.
- **Keep the Proposed toggle + Re-plan button** (our features; not in the handoff), restyled.

## Components

### `app/planner/EventBlock.tsx` (re-skin)
- Keep the props (`title`, `kind`, `topPct`, `heightPct`, `startLabel`, `pinned?`, `proposed?`)
  and the `data-testid="event-block"` + `data-kind`/`data-pinned`/`data-proposed` attributes and
  the `top`/`height` percentage styles.
- Replace the colour records with **literal class strings** keyed by `BlockKind` (so Tailwind's
  scanner emits them):
  - **Committed (solid):** `KIND_SOLID[kind]` = tinted bg + dark text, e.g.
    `meeting → 'bg-kind-meetingBg text-kind-meetingText'`,
    `task → 'bg-kind-taskBg text-kind-taskText'`,
    `habit → 'bg-kind-habitBg text-kind-habitText'`; plus a base `border-l-[3px]` and a per-kind
    left-bar colour `KIND_BAR[kind]` = `border-l-kind-meetingBar` / `border-l-kind-taskBar` /
    `border-l-kind-habitBar`. Block text is the dark hue (not white).
  - **Proposed (ghost):** `KIND_PROPOSED[kind]` = `border border-dashed` + translucent fill +
    hue text, e.g. `task → 'border border-dashed border-kind-taskBar bg-kind-taskBg/60
    text-kind-taskText'` (parallel for meeting/habit). `pinned` is ignored for proposed.
  - **Pinned (committed only):** override the left-bar colour to amber via the literal arbitrary
    class `border-l-[#f59e0b]` (the prototype's amber). Applied in addition to `KIND_SOLID`,
    after the kind bar class, so it wins.
- Layout polish to match the handoff block: `rounded-[6px]`, `px-[7px] py-1`, `text-[12.5px]`
  font-bold title, `overflow-hidden`. The leading time label keeps its `font-medium` span.

### `app/planner/WeekGrid.tsx` (re-skin)
- **Header strip** (`mb-*`, flex, items-center, gap): two square nav buttons
  (`h-[38px] w-[38px] rounded-[9px] border border-line bg-card text-inkSoft`) showing `‹` / `›`
  with `aria-label="Previous week"` / `aria-label="Next week"`; the **range label**
  (`text-[18px] font-bold`); a **"Today" pill** (`rounded-[9px] px-4 text-indigo font-bold`,
  `aria-label`/text "Today"); a flex spacer; then the **Proposed toggle**
  (`data-testid="toggle-proposed"`, `aria-pressed`, pill, active = indigoSoft) and the **Re-plan**
  button (`rounded bg-indigo text-white`, disabled while pending, text matches `/re-plan/i`); and
  the **legend** (Meeting/Habit/Task: an 11px rounded swatch in `bg-kind-*Bar` + capitalized
  label, `text-inkSoft`).
- **Calendar card:** `rounded-[14px] border border-line bg-card min-w-[820px] overflow-hidden`
  wrapped in an `overflow-x-auto` scroller.
- **Header grid:** `grid grid-cols-[64px_repeat(7,1fr)] border-b border-line`. Cell 0 empty. Each
  day cell (`data-testid="day-header-{i}"`, `data-today`): uppercase abbrev
  (`text-[13px] font-bold uppercase text-inkSoft`) + date number (`text-[21px] font-extrabold`);
  when today, the number sits in a **filled indigo pill** (`bg-indigo text-white rounded-[9px]
  px-[9px]`); `border-l border-line` between columns.
- **Body grid:** `grid grid-cols-[64px_repeat(7,1fr)]`. Gutter column renders **16 hour rows**
  (06→22) each `h-[58px]`, with the hour label (`6a`,`7a`,…,`12p`,…,`9p`) positioned at the row
  top (`text-[12px] text-[#a6aab8] font-semibold`). Each day column (`data-testid="day-col-{i}"`,
  `relative`, `border-l border-line`) draws its 16 `h-[58px]` rows (`border-t border-[#f1f2f6]`)
  then the absolutely-positioned `EventBlock`s (filtered to the column's `[d, d+24h)` and placed by
  `placeInDay`), then the `now-line` (`data-testid="now-line"`, `bg-crit`) at `nowLine(...)%`.
- **Hour-label format** (component-local pure helper): `hourLabel(h)` → `12a/1a…11a/12p/1p…11p`
  style; for our window the labels are `6a 7a 8a 9a 10a 11a 12p 1p 2p 3p 4p 5p 6p 7p 8p 9p`.
- `toItems` / the proposed-toggle logic / item-to-column filtering: **unchanged**.

### `app/planner/AtRiskPanel.tsx` (light restyle)
- Restyle to the card system: `rounded-xl border border-line bg-card shadow-card`; heading and
  items use `text-crit`/`bg-crit/10` tones. Keep the props, `data-testid="at-risk-item"`, the
  empty-state copy, and `humanizeMs`. No behavior change.

## Data flow

Unchanged. `Planner.tsx` still computes the week, fetches `useScheduleQuery`/
`useCalendarEventsQuery`/`useSchedulePreviewQuery`, and passes `blocks`/`events`/`proposed` +
the nav/replan callbacks to `WeekGrid`, and `preview.unscheduled` to `AtRiskPanel`. The only
`Planner.tsx` change permitted is incidental layout class tweaks (e.g. spacing) if needed; its
logic stays.

## Error handling

Unchanged — `Planner.tsx` keeps its existing error strip + Retry and the "Re-plan failed" message.

## Testing (jsdom; fakes; `TZ=UTC`)

- **`weekModel.test.ts`:** untouched, stays green.
- **`EventBlock.test.tsx`:** update the styling assertions to the new model — a committed block
  has `data-proposed="false"`, no `border-dashed`, and a kind text class (e.g.
  `text-kind-taskText`) instead of `text-white`; a proposed block keeps `data-proposed="true"` +
  `border-dashed`; `data-kind`/`data-pinned` and `top`/`height` percentage assertions preserved;
  add/keep a pinned case asserting the amber bar class (`border-l-[#f59e0b]`).
- **`WeekGrid.test.tsx`:** update the nav-button lookups from `{ name: '◀' }`/`'▶'` to
  `{ name: /previous week/i }` / `{ name: /next week/i }`. All other assertions
  (event-block placement by kind, `day-header-2` `data-today`, `now-line`, `/re-plan/i`,
  `toggle-proposed` show/hide) preserved.
- **`Planner.test.tsx`:** update the `{ name: '▶' }` button lookups (two) to `{ name: /next
  week/i }`. The text assertions (`Write spec`, `Standup`, `Tax filing`), `toggle-proposed`, and
  `/re-plan/i` are preserved.
- Build/typecheck clean (`tsc -p tsconfig.json && vite build`); full monorepo suite green.

## Scope / decomposition (for the plan)

~3 TDD tasks, sequential:
1. **`EventBlock` re-skin** — kind tint + 3px bar + dark text; proposed dashed/translucent;
   pinned amber bar; update `EventBlock.test.tsx`.
2. **`WeekGrid` re-skin** — header strip (square nav buttons + range + Today pill + Proposed +
   Re-plan + legend), white card, day-header pills, 64px gutter + 58px/hr rows + per-hour labels;
   update `WeekGrid.test.tsx` + `Planner.test.tsx` nav-button names. (Proposed/now-line/nav/
   re-plan behavior unchanged.)
3. **`AtRiskPanel` restyle + verification** — card restyle; run the full web suite + build, then
   the whole monorepo suite.
