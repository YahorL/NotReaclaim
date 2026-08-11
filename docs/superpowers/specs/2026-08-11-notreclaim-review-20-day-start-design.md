# NotReclaim Review 20 — configurable planner day start ("day ends at 3 AM")

**Date:** 2026-08-11 · **Status:** approved (user: VIEW-ONLY; a setting, default midnight)

## Goal
A `Settings.dayStartMinute` (0–1439, default 0) shifts the planner's visual day boundary: with
180, each column runs 03:00 → 03:00 next day, so late-night work/blocks stay on "today's"
column. **Scheduling semantics are untouched** — habit days, the once-per-day cap, eligible
days, due dates, and working-hours expansion all keep the midnight boundary.

## Changes
1. **db:** `Settings.dayStartMinute Int @default(0)` + migration.
2. **server:** settings zod accepts `dayStartMinute` int 0–1439; GET/PUT round-trip it.
   `ensureUserDefaults` includes 0 (explicit).
3. **web settings UI:** "Day starts at" time field on the Settings page (design-system,
   formatted like the other time fields; settingsForm round-trips it; default 00:00).
4. **web planner (the substance):** thread `dayStartMinute` (default param 0 everywhere so
   existing tests stay byte-identical, same pattern as R16a's `zone='UTC'`) through weekModel
   and consumers:
   - Column anchor: a column's start = zone-aware local midnight **set to the wall-clock
     hour/minute of dayStartMinute** (luxon `set {hour, minute}`, NOT `+minutes`, so DST days
     stay correct), spanning 24h to the next day's same wall-clock time.
   - `dayColumns`, `placeInDay` (block→column mapping + clip at column edges), `nowLine`,
     `isToday`/today-highlight (= column whose [start, start+24h) contains now),
     `localMidnight`-based "Today" anchor (at 01:30 with a 03:00 start, today's column is
     yesterday's date), auto-scroll-to-now, `snapClickToSlot`, `clampToWindow`, cross-day drag
     (`shiftDays`/clampDayDelta operate on column starts).
   - Hour gutter labels rotate: first row = dayStart hour (3a, 4a, … 2a); day header shows the
     column's start date.
   - `Planner.tsx` reads `dayStartMinute` from the settings query (already fetched for
     timezone) and threads it alongside `zone`.
5. **Demo/user:** no data migration needed; the user sets 03:00 in Settings themselves.

## Explicitly unchanged
Engine, assemble, habit expansion, stats day-bucketing, CreatePopover's default due-date
("clicked day 23:59" keeps calendar-date semantics), Google sync. A block spanning the
boundary clips at the column edge exactly as midnight-spanning blocks do today.

## Tests
weekModel: column starts at 03:00 wall clock (incl. a DST-transition day), placeInDay maps a
01:00 block onto the PREVIOUS day's column with correct y-offset, today-column selection at
01:30, snap/clamp relative to column start, hour-label rotation; default-0 paths byte-identical
(existing suite untouched). settingsForm round-trip; server schema bounds (1440 → 400); db
default 0. Planner integration: threading + header dates.
