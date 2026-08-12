# NotReclaim Review 21 — habit placement: preferred-first ordering + missed occurrences stay put

**Date:** 2026-08-12 · **Status:** approved (user: missed habit "stays put as missed"; ordering fix unambiguous)

## Problems (live reports, mechanisms confirmed)
1. **Preference-less habits squat on preferred windows.** All habits share priority 0; a habit
   with no preferred window (CleanUp) falls back to the start of working hours (10:00) — inside
   Morning Routine's exact 10:00–11:00 preferred window — whenever it happens to be placed
   first, cascading Morning to 11:25.
2. **An un-done habit chases "now" all day.** Once its preferred window and working hours have
   passed, today's occurrence re-places at the earliest remaining free time (= now) on every
   replan (day-keyed row is pulled forward), rolling until midnight. User wants: once a habit
   block's start time has passed, it stays where it was (visibly missed); nothing re-schedules
   it that day.

## Changes
1. **Engine ordering (scheduler/schedule.ts):** among work items of EQUAL priority, habits WITH
   `preferredWindows` sort before habits without; tasks are unaffected relative to each other
   (keep priority → sortOrder/order → tie → id for them). Implement as an explicit comparator
   term (do not overload the numeric `order` field with magic values). Deterministic overall
   order must remain (final id tiebreak stays).
2. **Begun habit blocks are history (core + scheduler + apply):**
   a. `assemble.ts`: for each habit, non-pinned blocks with `startsAt <= now` that started
      TODAY (their day-window would still be re-placeable) have their start times passed to the
      engine for day consumption. Reuse the existing day-consumption channel: rename the engine
      field `pinnedSlotTimes` → `consumedSlotTimes` (it already means "retire these days, emit
      nothing") and feed it BOTH pinned-block starts (as today) AND begun-block starts.
      `periodTargets` reduction stays pinned-only — a missed occurrence may still be re-placed
      on ANOTHER eligible day later in the week if the weekly target has room (once-per-day cap
      unaffected).
   b. `apply.ts` delete sweep: never delete a HABIT row that has already begun —
      skip when `block.habitId != null && block.startsAt.getTime() <= now` (in addition to the
      existing `endsAt <= now` history skip). Task rows keep the current sweep exactly (an
      in-progress task placement being superseded by a replan must still be removable).
3. Net behavior: a habit block whose start has passed freezes in place (past = missed/done —
   the app has no habit-completion concept); the engine never emits today's occurrence again;
   tomorrow is planned normally. The R18 "rolls forward at now per replan" known-issue class
   disappears for both preferred and preference-less habits.

## Explicitly unchanged
Once-per-day cap; day-keyed engine ids; sticky slots (future blocks only, as today); pinned
handling; buffers; tasks' sweep semantics; habit weekly targets (`perPeriod`).

## Tests
Engine: equal-priority habit pair (preferred + preference-less) → preferred one gets its window
regardless of id order; explicit regression of the live case (15m no-pref habit + 1h 10:00–11:00
pref habit, working hours from 10:00 → pref habit at 10:00). `consumedSlotTimes` consumes days
for both sources; renamed field threaded (compile-level). Core: assemble passes begun-today
block starts + pinned starts merged; yesterday's past blocks NOT passed (no-op days). Apply:
begun habit row survives a replan whose desired set omits its key; begun TASK row is still
swept; fully-past rows still skipped (existing). Integration-style: replan at T+1h after a
habit block started at T → row unchanged, no new block that day, counts {0,0,0} for that habit.
