# NotReclaim Review 22 — no task buffer inside habit preferred windows

**Date:** 2026-08-13 · **Status:** approved (mechanism confirmed from live screenshot)

## Problem
`taskBufferMs` (R17, two-sided) makes exactly-sized preferred windows unusable when anything
sits adjacent: Morning Routine (chunk 1h, preferred 10:00–11:00) + CleanUp at 11:00 → CleanUp's
leading buffer eats 10:45–11:00 → the 1h chunk no longer fits the window → tier-2 fallback to
11:25. Order fixes can't help; any neighbor's buffer encroaching on an exact-size window kills
tier 1.

## Change (engine, `scheduleHabit` only)
A preferred window is exact user intent — the buffer does not apply within it:
1. **Tier-1 placements** (into `preferredWindows`) call `placeItem` with `gapMs = 0`: the chunk
   both FITS the exact window and RESERVES exactly `[start, end]` (no ± padding), so two habits
   whose windows abut (10–11 and 11:00–…) can sit back-to-back by design, order-independently.
2. **Kept sticky slots that lie inside a preferred window** likewise reserve `[start, end]`
   exactly (they are tier-1 equivalents). Sticky slots of preference-less habits keep the
   current ± gap reservation.
3. Tiers 2/3 (fallback) and task placement are UNCHANGED: full `gapMs` fit + two-sided
   reservation. A task placed after a window-placed habit still keeps its own buffer distance
   (the task's placement reserves `[start−gap, end+gap]`); only habit-window placements stop
   pushing others away.

## Consequences
- Morning 10:00–11:00 and CleanUp 11:00 coexist exactly as configured; small tasks no longer
  backfill a broken window.
- Two habits' preferred windows separated by < gap (e.g. 10–11 and 11:05) also both place —
  accepted: explicit windows override the generic gap.
- Existing mis-placed blocks migrate on the next replan (sticky already yields to preferred).

## Tests
Engine (items/schedule): the live regression verbatim — habit A chunk 1h preferred 10–11, habit
B preferred 11:00–11:15, gap 15m, working hours from 10:00 → A at 10:00–11:00 AND B at
11:00–11:15 in BOTH placement orders; a task placed afterward keeps ≥ gap from both; tier-2/3
fallback placements still reserve ± gap (existing tests stay green); sticky kept slot inside
preferred reserves exactly (a later same-day placement may abut it, a task may not); exact-size
window fits even when a block abuts the window edge on either side.
