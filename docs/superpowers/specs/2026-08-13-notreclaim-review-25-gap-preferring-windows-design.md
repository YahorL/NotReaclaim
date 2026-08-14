# NotReclaim Review 25 (REVISED) — universal buffers + tightest-window-first habit ordering

**Date:** 2026-08-13 · **Status:** approved (user chose "Buffer everything" over windows-override-buffer; this REPLACES the earlier draft of this spec — the two-attempt gap-preferring design is abandoned)

## Rule
One buffer rule everywhere: every auto-placed block (task chunk, habit occurrence, kept sticky
slot) fits and reserves `[start − gapMs, end + gapMs]`. No window exemption, no suspension, no
reconciliation. Windows only constrain WHERE a habit may go; they never disable the gap.

## What makes it correct: ordering
Exact-size windows survive universal buffers only if tight-window habits claim their spots
before anyone's reservation encroaches. Replace the R21 `claim` comparator term with a graded
key at equal priority+order:
- habits WITH preferredWindows: `slack = max(0, min(window length across its preferred
  windows) − chunkMs)` — ascending (slack 0 = exactly-sized window places first);
- habits WITHOUT preferredWindows: after all with-window habits;
- tasks: last (R21 decision, unchanged — provably placement-inert vs habits).
Deterministic tiebreaks preserved (`tie`, then id).

## What gets DELETED (net simplification)
- R22 `windowReservation` + `preferredUnion` threading and zero-gap tier-1 fit/reservation.
- R23 `suspendedMargins` + the post-last-habit reconciliation in `schedule()`.
- The R25-draft two-attempt logic (never merged).
Tier-1/2/3 all become plain `placeItem(..., gapMs)` calls, differing only in candidate
windows. Sticky kept slots reserve ± gap uniformly (the inside-preferred special case goes).

## Unchanged
Once-per-day cap, day-keyed ids, consumedSlotTimes/frozen begun blocks, sticky validity rules
(chunk-length, day-free, inside-preferred-when-set, fits free∩bound), pinned ± gap busy
padding, meetingBufferMs, R24 5-min alignment, task confinement to working hours.

## Accepted consequences (user-confirmed)
- Two exactly-sized ABUTTING windows can no longer both be honored: the tighter/earlier-sorted
  one wins its window; the other relocates with full gap (falls back per tiers).
- A wide-window habit starts `gap` after a neighboring block inside its window (CleanUp
  [11:00–22:00] after Morning ending 11:00 → 11:10) — this is the user's headline case.
- placeItem's FIT never consults gapMs (unchanged), so an exact window whose interior is
  untouched still fits exactly — e.g. Morning [10:00–11:00] with working hours starting 10:00
  → placed 10:00–11:00; its reservation pads outward only.

## Expected live layout (acceptance)
Working hours 10:00–17:00 (habits roam), gap 10m: Morning [10:00,11:00] (slack 0, first);
CleanUp (slack ~10.75h) → [11:10,11:25]; Evening [23:29,23:59] (slack 0) unaffected; first
task ≥ 11:35. R22's "both abutting exact windows place" centerpiece REVERSES: the later-sorted
one now relocates — flip that test with a comment referencing this spec.

## Tests
Ordering: slack-0 habit places before wide-window habit before no-window habit before task
(equal priority); deterministic on slack ties. Placement: the acceptance layout above red-first
(CleanUp currently 11:00 → expect 11:10); exact window fits when interior free; exact window
falls back when a pinned block's padding intrudes (pre-existing behavior, now pinned by test);
Evening 23:29 regression; abutting-windows reversal (flipped R22 centerpiece); sticky
kept-slot ± gap reservation uniform; R24 alignment composes (11:10 already aligned). Deletion
hygiene: no reference to windowReservation/suspendedMargins/preferredUnion remains (grep).
