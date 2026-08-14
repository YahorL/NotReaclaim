# NotReclaim Review 24 — align auto-placed starts to the 5-minute grid

**Date:** 2026-08-13 · **Status:** approved (user: "instead of 5:07 make it 5:05")

## Problem
Placements anchored to `now` (today's frozen/rolling starts, post-meeting slots at odd
minutes) produce ragged times like 8:07 PM. Users expect clock-friendly starts.

## Change (engine, `placeItem` only)
When picking a slot, compute `aligned = ceil(slot.start / 5min) * 5min` (epoch-ms math —
5 divides 60 so this is timezone-safe). If `aligned + size <= slot.end` AND
`aligned + size <= deadline`, place at `aligned`; otherwise place at the raw `slot.start`
(exact-fit windows like Evening Routine's 23:29–23:59 × 30m chunk MUST keep working — the
fallback is mandatory, not best-effort). Reservation math unchanged (operates on the chosen
placement). Applies to tasks and habits alike (all placement flows go through `placeItem`);
sticky kept slots are NOT re-aligned (they are verbatim by design); pinned/manual times are
user-owned and untouched.

## Consequences
- Slot search remains earliest-fit; alignment can shift a start by at most 4 minutes and can
  cascade (each subsequent placement aligns again — gaps between blocks may exceed the buffer
  by up to 4 min; accepted).
- Day-keyed habit ids unaffected (keyed on the consumed window entry, not the start).
- Existing odd-minute frozen blocks stay as history; new placements align going forward.

## Tests
placeItem: 5:07 free start → 5:10 placement; alignment skipped when it would overflow the slot
(23:29–23:59 window, 30m chunk → 23:29 kept); alignment skipped when it would breach the
deadline; already-aligned start unchanged; gap reservation measured from the aligned start.
scheduleHabit/scheduleTask integration: odd `now`-clipped free start → aligned block; Evening
Routine regression verbatim (preferred 23:29–23:59, chunk 30m → placed 23:29). Existing suite:
tests with odd-start fixtures may legitimately shift by ≤4 min — update ONLY placements whose
fixture free-start is not 5-min aligned, and list each edit in the report.
