# NotReclaim Review 18 — habits ignore working hours

**Date:** 2026-08-11 · **Status:** approved (user chose "Habits ignore work hours" over soft/hard preferred-window variants)

## Problem (live report)
Working hours (e.g. 10:00–17:00) bound ALL scheduling: `schedule()` derives the shared free
timeline from `workingWindows`. A habit whose preferred window lies outside working hours
(Evening Routine 23:29–23:59) can never be placed there; the soft-preference fallback then
takes the earliest working-hours slot (10:00), which in turn occupies another habit's exact
preferred window (Morning Routine 10:00–11:00, 1h chunk) and cascades it out of its window.

## Change
1. **Engine** (`packages/scheduler`): `ScheduleInput` gains optional `horizon?: Interval`.
   When present: `free = subtract([horizon], busy)` (full-day envelope), and each task's
   candidate windows become `intersect(task.allowedWindows ?? workingWindows, workingWindows)`
   so tasks stay inside working hours exactly as today. When `horizon` is absent, behavior is
   byte-identical to today (back-compat for existing tests). Habits need no engine change to
   roam: their `allowedWindows` are already full eligible days; only the free envelope
   confined them. Preferred windows remain soft-first (unchanged mechanics).
2. **Sticky-slot validity** (`scheduleHabit`): a kept `existingSlot` is valid only if — in
   addition to the Review 17 rules — it lies fully inside one of the habit's
   `preferredWindows` when the habit has any. Otherwise it is re-placed (preferred-first).
   This is a deliberate reversal of R17's "stickiness beats preference" for habits WITH a
   preferred window; without one, stickiness is unchanged. Without this, mis-placed habit
   blocks would be kept forever and the fix would never become visible.
3. **Core** (`assemble.ts`): pass `horizon: { start: now, end: horizonEnd }` (the same values
   already computed) into the engine input.

## Consequences / accepted trade-offs
- A habit with NO preferred window may land at the very start of an eligible day (user
  explicitly accepted; mitigation = set preferred windows).
- One-time migration on first replan: habits with preferred windows move into them (sticky
  rule 2); day-key ids may change day → delete/recreate of those Google events, once.
- Meetings/blocks outside working hours now correctly consume free time for habits.
- Buffers (two-sided, pinned padding) operate on the same single free timeline — unchanged.

## Tests
Engine: horizon-present → habit placed outside workingWindows in its preferred window; task
still confined to workingWindows (both with and without task.allowedWindows); horizon-absent
→ existing behavior (suite must stay green untouched). Sticky: slot outside preferred window
re-placed into it; slot inside preferred kept verbatim; habit without preferred keeps
out-of-window slot (stability unchanged). Core: assemble sets `horizon` from now/horizonDays.
