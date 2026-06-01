# NotReclaim Web — Stats Dashboard — Design Spec

**Date:** 2026-05-31
**Status:** Approved (ready for implementation planning)
**Parent:** Redesign Milestone 3 (the last design-handoff view; follows M1 shell+Priorities `80bb972`
and M2 Planner re-skin `3f3916c`).
**Design source:** `design_handoff_notreclaim/app/pages.jsx` (Stats) + README "Stats" section.

## Summary

Build the **Stats dashboard** at `/stats`, replacing the current "Coming soon" `StatsPlaceholder`.
It renders the handoff's layout — a 4-card summary row, a "Hours by day" stacked bar chart, and a
"Time split" donut — computed **entirely client-side** from existing API data for the **current
week (Mon–Sun)**. No analytics backend is added.

## Goals

- A `/stats` page matching the handoff: summary cards + stacked bar chart + donut, on the dark shell.
- Numbers computed client-side from existing queries; **works without Google** (uses the engine's
  proposed plan), degrading honestly where data needs Google (meetings) or is absent (empty state).
- Pure, unit-tested aggregation (`TZ=UTC`, injected `now`); deterministic component/page tests.

## Non-Goals

- No backend/`/stats` endpoint, no new API client method, no engine change.
- No historical/actuals tracking (no "time logged" analytics) — this dashboard summarizes the
  **planned** week, not past actuals.
- The handoff's **Focus kind is dropped** (NotReclaim has no focus blocks; same as M2). Charts use
  **Task / Meeting / Habit**.
- Not bucketing committed `/schedule` blocks (they would double-count the proposed plan).

## Decisions (locked during brainstorming)

- **Data source = proposed plan + tasks** (client-side):
  - Task & Habit hours ← `useSchedulePreviewQuery()` proposed blocks (`sourceType` `'task'`/`'habit'`),
    filtered to this week, bucketed by day. (Proposed, not committed — so it populates without Google.)
  - Meeting hours ← `useCalendarEventsQuery(weekFrom, weekTo)` (Google meetings this week; 0 until
    Google connects).
  - Tasks done ← `useTasksQuery()` (completed vs total).
- **Range = current week (Mon–Sun)** via `weekModel.startOfWeek(now())` + `dayColumns`.
- **Series/colors:** Task = orange (`kind.taskBar`), Meeting = red (`kind.meetingBar`), Habit =
  green (`kind.habitBar`).
- **4 cards** (handoff positions): Total scheduled (indigo) · **Task time** (orange — the handoff's
  "Focus time" slot, renamed) · In meetings (red, "{n} events") · Tasks done (green, "{pct}% complete").
  Habit hours appear in the charts but not as a 4th card (keeps the count at 4).

## Architecture / Components

### `app/stats/statsModel.ts` (pure, no `Date.now`/argless `new Date`)
- `interface KindMs { task: number; meeting: number; habit: number }` (per-day/aggregate ms).
- `hoursByDay(days: number[], preview: SchedulePreview | undefined, events: CalendarEvent[]): KindMs[]`
  — for each of the 7 day-midnight timestamps in `days`, sum: proposed task/habit block ms whose
  `start` ∈ `[day, day+24h)`, and meeting ms from `events` whose `Date.parse(startsAt)` ∈ that day.
  (Each block's contribution = `end - start`; meetings = `endsAt - startsAt`.) Returns 7 `KindMs`.
- `summary(perDay: KindMs[]): { totalMs; taskMs; meetingMs; habitMs }` — column sums; `totalMs` =
  task+meeting+habit.
- `meetingCount(days, events): number` — events whose start falls in the week.
- `taskCompletion(tasks: Task[]): { done: number; total: number; pct: number }` — `total` = tasks
  with `status !== 'archived'`; `done` = `status === 'completed'`; `pct` = `round(done/total*100)`
  (0 when total 0).
- `donutSegments(s: { taskMs; meetingMs; habitMs }): { kind: 'task'|'meeting'|'habit'; ms: number;
  fromPct: number; toPct: number }[]` — ordered task→meeting→habit, cumulative percentages of the
  non-zero total; empty array when total 0.
- `formatHours(ms: number): string` — hours to 1 decimal, trailing `.0` stripped, suffix `h`
  (e.g. `"34h"`, `"21.5h"`, `"0h"`).
- `MAX_BAR_MS` helper or inline: chart scale = `Math.max(8h, busiest day total)`.

### Components (`app/stats/`)
- **`StatCard.tsx`** — props `{ label; value; sub; accent }` (`accent` = a text-color class, e.g.
  `text-indigo`/`text-kind-taskText`/`text-crit`/`text-low`). White card (`rounded-[14px] border
  border-line bg-card shadow-card p-5`); label (`text-[14.5px] font-bold text-inkSoft`), value
  (`text-[36px] font-extrabold` + accent), sub (`text-[14px] text-inkSoft`).
- **`HoursByDayChart.tsx`** — props `{ perDay: KindMs[]; dayLabels: string[] }`. Card with title
  "Hours by day"; a 220px-tall row of 7 day groups; each group a stacked vertical bar (34px wide,
  200px max), stacking **task (`bg-kind-taskBar`) over meeting (`bg-kind-meetingBar`) over habit
  (`bg-kind-habitBar`)**, heights = `(ms / scaleMs) * 200`px where `scaleMs = max(8h, busiest day)`;
  top corners rounded; day label below. Each bar segment height is the one permitted dynamic inline
  `style` (a computed px height Tailwind can't express). `data-testid="hours-by-day"`.
- **`TimeSplitDonut.tsx`** — props `{ segments; totalMs }`. A 150px `conic-gradient` ring (**the one
  sanctioned inline `style`**, like the shell avatar — Tailwind can't express conic gradients) with a
  96px white hole showing `formatHours(totalMs)` + "total"; below, a legend row per kind (colored
  dot + capitalized label + `formatHours`). `data-testid="time-split"`. Empty (total 0): a muted
  "No scheduled time yet" instead of the ring.

### Page — `app/pages/Stats.tsx`
`function Stats({ now = () => Date.now() })`. Computes `weekStart = startOfWeek(now())`,
`days = dayColumns(weekStart)`, `fromIso/toIso` = week bounds; runs `useSchedulePreviewQuery()`,
`useCalendarEventsQuery(fromIso, toIso)`, `useTasksQuery()`. Derives `perDay`, `summary`,
`meetingCount`, `taskCompletion`, `donutSegments` via the pure model. Layout: scrollable
`px-[30px] pb-10`; a summary row of 4 `StatCard`s (flex, gap); a charts row (`HoursByDayChart`
flex-2 + `TimeSplitDonut` flex-1). Loading → a small "Loading…"; error → the existing error-strip
pattern + Retry. **Empty state:** when `summary.totalMs === 0` and `taskCompletion.total === 0`,
show a centered friendly "Nothing scheduled yet — add tasks or habits and they'll show up here."
(cards/charts still render with zeros otherwise — e.g. tasks exist but no proposed blocks).

### Routing — `app/App.tsx` + retire placeholder
`/stats` element swaps from `StatsPlaceholder` to `Stats`. Delete `app/pages/StatsPlaceholder.tsx`.
Update `App.test.tsx`'s `/stats` test: it currently asserts `/coming soon/i`; change it to assert a
Stats marker (e.g. the "Hours by day" text or a summary card label) renders, using an `authedApi()`
that already returns empty `getSchedulePreview`/`listTasks`/`getCalendarEvents` (add
`getCalendarEvents` to the helper if missing — it returns `[]`).

## Data flow

`Stats` → 3 queries → `statsModel` pure fns → cards + charts. `useCalendarEventsQuery` uses the
week range; `useSchedulePreviewQuery` returns the whole horizon and the model filters to the week.
No new query keys, no mutations.

## Error handling

If any query errors, show the error strip + Retry (refetch all three), mirroring `Planner.tsx`.
Missing/undefined data is treated as empty (zeros) by the pure model — never throws.

## Testing (jsdom; fakes; `TZ=UTC`)

- **`statsModel.test.ts`:** `hoursByDay` buckets proposed task/habit + meetings into the right day
  (within-week filtering; ms = end−start) under `TZ=UTC`; `summary` column sums; `meetingCount`;
  `taskCompletion` (done/total/pct incl. total-0 → 0, archived excluded); `donutSegments` cumulative
  percentages + empty when total 0; `formatHours` ("34h"/"21.5h"/"0h").
- **Components:** `StatCard` renders label/value/sub + accent class; `HoursByDayChart` renders 7 day
  groups with non-zero bar heights for a busy day (`data-testid`); `TimeSplitDonut` legend shows the
  per-kind hours and the center total, and the empty variant when total 0.
- **`Stats` page** (`renderWithProviders` + `fakeApiClient`): a preview fixture with task+habit
  blocks in the current week + a couple tasks renders populated cards ("Total scheduled", "Tasks
  done" value) and the chart/donut; an all-empty fixture renders the empty state.
- **`App.test.tsx`:** `/stats` renders the Stats dashboard (not "coming soon").
- Build/typecheck clean; full monorepo suite green.

## Scope / decomposition (for the plan)

~3 TDD tasks:
1. **`statsModel.ts`** pure module (+ tests).
2. **`StatCard` + `HoursByDayChart` + `TimeSplitDonut`** components (+ tests).
3. **`Stats.tsx` page** + `/stats` routing swap + retire `StatsPlaceholder` + `App.test` update +
   full verification (all packages + web build).
