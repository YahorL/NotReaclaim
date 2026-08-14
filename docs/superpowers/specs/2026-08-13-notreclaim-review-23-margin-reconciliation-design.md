# NotReclaim Review 23 — reconcile unclaimed window margins

**Date:** 2026-08-13 · **Status:** approved (live screenshot: task flush at 11:15 after a window-placed habit; R22's reviewer pre-identified the mechanism and fix direction)

## Problem
R22 suspends the ±`gapMs` reservation of tier-1 (and sticky-in-window) habit placements over
the union of ALL habits' **declared** preferred windows so that abutting windows stay
placeable. But declared ≠ claimed: a habit's own wide/trailing window, and daily windows of
weekly-target habits on their off days, leave buffer-free margins that later-placed tasks fill
flush (Research at 11:15 against CleanUp 11:00–11:15).

## Change (engine only)
Claim-aware two-phase reservation:
1. `scheduleHabit` additionally returns `suspendedMargins: Interval[]` — the parts of each
   tier-1/sticky-in-window placement's `[start−gap, end+gap]` margin that were NOT reserved
   because they fell inside the declared-window union (i.e. `padded − reservation`, clipped to
   the margin; provenance-free).
2. `schedule()` accumulates them and, immediately after processing the LAST habit work item
   (index precomputed from the sorted order), re-reserves the unclaimed remainder:
   `free = subtract(free, mergeIntervals(allSuspendedMargins) − allHabitBlockSpans)` where
   `allHabitBlockSpans` = spans of every habit block placed or kept this run (any tier) plus
   pinned habit blocks. Margins actually covered by a neighboring habit block re-reserve
   nothing (abutting windows keep working); everything else gets its pad back before any
   subsequent item places.
3. Known, documented limitation: a TASK whose priority sorts it BEFORE some habit places
   pre-reconciliation and may still sit flush against an earlier-placed habit's suspended
   margin. Unreachable with real data (all habits are priority 0, so every task places after
   reconciliation); record in the engine doc comment, do not solve.

## Explicitly unchanged
Tier-1 zero-gap fit; the declared-window union at placement time (needed so later habits'
windows stay reachable); tiers 2/3, tasks, pinned padding, once-per-day cap, day-keyed ids,
sticky rules.

## Tests
Engine: the live case — Morning 1h@[10,11], CleanUp 15m@[11,11:15] (wide own window
[11,12]), gap 15m → Morning [10,11], CleanUp [11,11:15], task ≥ [11:30] (currently 11:15 —
red first); off-day case — Morning placed, CleanUp target exhausted (day consumed /
perPeriod 0 this period) → task after Morning ≥ gap (currently flush — red first); abutting
windows still coexist in both orders (existing R22 centerpiece stays green untouched);
sticky-in-window kept slot's margin reconciles identically; reconciliation happens before a
LOWER-priority task places and not before a higher-priority one (limitation pinned as a
characterization test).
