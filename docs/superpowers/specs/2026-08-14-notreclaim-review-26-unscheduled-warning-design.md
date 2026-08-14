# NotReclaim Review 26 — visible warning for unschedulable tasks/habits

**Date:** 2026-08-14 · **Status:** approved (user: "add some kind of warning if a task or habit cannot be scheduled")

## Current state
`GET /schedule/preview` (`computeDesiredSchedule`) already returns `unscheduled:
UnscheduledItem[]` — task remainders (`sourceType 'task'`, `remainingMs`) and missed habit
occurrences (`sourceType 'habit'`). The web uses it ONLY for the task panel's per-card ⚠
(`PlannerTaskPanel.tsx` `atRiskIds`, task-only). Missed habits are silent; with the panel
hidden, everything is silent. Universal buffers (R25) make dense-day unscheduled items more
common, so the signal matters now.

## Change (web only — no server/engine work)
1. **Warning banner on the Planner**, above the week grid, rendered whenever
   `preview.unscheduled` is non-empty (testid `unscheduled-warning`):
   - Design-system: amber/warning tone consistent with the app (NOT the red `crit` used for
     at-risk chips — this is "couldn't fit", not "overdue"); compact single row.
   - Content: "⚠ Couldn't schedule everything:" followed by up to 3 entries —
     task → `{title} ({remaining} left)` using the existing duration formatter;
     habit → `{title} ({n} missed)` aggregating that habit's unscheduled occurrences.
     More than 3 → append `+N more` with a `title` attribute listing the rest.
   - Titles resolved from the existing tasks/habits queries (`useTasksQuery`,
     habits query); an unresolvable id falls back to "(deleted)" and never crashes.
   - Not dismissible: it disappears when the condition clears (next replan that fits
     everything). No new state, no persistence.
2. **Habit rows on the Habits page** get the same ⚠ chip the task panel uses (testid
   `habit-at-risk`, `title` = "N occurrences couldn't be scheduled this week") when the
   preview reports missed occurrences for that habit — reuse the preview query.
3. PlannerTaskPanel task behavior unchanged.

## Non-goals
Push notifications/emails; per-block visualization of missed occurrences; server changes;
dismissal state.

## Tests
Banner: hidden when unscheduled empty; renders task remaining + habit missed-count entries;
+N more overflow with full list in title; unresolvable id fallback; amber styling class pinned
loosely (presence of the testid + a stable class token). Habits page: chip renders with count,
absent when clean. Existing panel tests untouched.
