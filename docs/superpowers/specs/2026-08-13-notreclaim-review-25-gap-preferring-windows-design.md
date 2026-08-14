# NotReclaim Review 25 — gap-preferring placement inside habit windows

**Date:** 2026-08-13 · **Status:** approved (user: "why not all tasks have gaps of 10 minutes around them?")

## Problem
R22 places a habit at its preferred window's earliest free instant with zero gap, so a window
that merely *starts* where another block ends (CleanUp window from 11:00, Morning ends 11:00)
produces flush contact even when the window is wide enough to afford the gap (chunk 15m in a
60m window could start 11:10). The user's mental model: gaps everywhere they physically fit;
windows override the gap only when they must.

## Change (engine, tier-1 placement + sticky unchanged)
Tier-1 becomes two attempts:
1. **Gap-respecting attempt:** place the chunk inside `preferred ∩ bound` on a free timeline
   that EXCLUDES the accumulated suspended margins (this run's pending `suspendedMargins`,
   threaded from `schedule()` into `scheduleHabit`, plus the habit's own margins accumulated so
   far) — i.e. the space a normal ±gap reservation would have covered. Placement itself still
   uses `gapMs = 0` fit semantics and the R22/R23 `windowReservation` reservation.
2. **Fallback (current behavior):** if attempt 1 finds no room, place on the full free timeline
   exactly as today (flush allowed — exact-size windows keep working).

Result: CleanUp in a wide 11:00+ window lands 11:10 (gap after Morning); Evening Routine's
exact 23:29–23:59 window still lands 23:29; two exactly-abutting exact windows still abut.
Tasks and tiers 2/3 are untouched (they already respect margins post-R23 reconciliation; note
tier-2/3 placements occur on the pre-reconciliation timeline — unchanged behavior, out of
scope).

## Threading
`schedule()` already accumulates `suspendedMargins` across habits (R23); pass the accumulated
list into each `scheduleHabit` call (new optional param; undefined → attempt 1 uses just the
habit's own accumulated margins, preserving direct-call test behavior).

## Tests
Live case: Morning 1h@[10,11] + CleanUp 15m window [11:00,12:00], gap 10m → Morning [10,11],
CleanUp [11:10,11:25] (red-first: currently 11:00), in both placement orders. Exact window
regression: CleanUp window [11:00,11:15] → 11:00 flush (fallback). Evening 23:29 regression
stays green. Attempt-1 must also respect margins of the SAME habit's earlier occurrence (two
occurrences same week, adjacent days unaffected; same-day impossible via cap). 5-min alignment
(R24) composes: gap-respecting start also aligns.
