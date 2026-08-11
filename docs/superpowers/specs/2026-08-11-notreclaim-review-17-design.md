# NotReclaim Review 17 — buffer invariant, stable habits, reschedulable app events, once-per-day habits

**Date:** 2026-08-11
**Status:** approved (user-confirmed in session)

Four user-reported items from the first real deployment. A = bug fix, B–D = behavior changes.
User answers that shaped this design: the missing buffer is observed **around pinned/manual
blocks**; "locked habits" means **stable across replans, still draggable** (drag pins, as today);
event rescheduling should be **drag + edit drawer**; habits must occur **at most once per day**.

## A. Task buffer becomes a two-sided geometric invariant

**Current behavior (root cause, verified by engine repro).** `taskBufferMs` is implemented as a
trailing-only free-time reservation: `placement.ts:73` subtracts `[start, end + gap]` after each
placement. Consequences, all reproduced:
- Auto blocks placed *after* a pinned block sit flush against it (pinned blocks are subtracted as
  raw busy intervals in `schedule.ts:25-29`) — the user's exact complaint, and common because
  every drag/resize/click-to-create/Start/Stop pins a block.
- Two *auto* blocks can touch when placement order puts the later-clock block first (window/
  notBefore/priority-constrained tasks), because nothing reserves space *before* a placed block.
- Auto blocks placed before habits (or vice versa) can touch for the same reason.

**Change.**
1. `packages/scheduler/src/placement.ts`: reserve `[start − gapMs, end + gapMs]` when consuming
   free time (two-sided).
2. `packages/scheduler/src/schedule.ts`: when building the busy set, pad **pinned blocks** by
   `blockBufferMs` on both sides. Fixed events keep their existing, separate `meetingBufferMs`
   padding (applied in `core/assemble.ts`); `taskBufferMs` is not additionally applied to events.

**Invariant after the change:** any engine-placed block keeps ≥ `taskBufferMs` distance from every
other engine-placed block, habit block, and pinned block — independent of placement order.

**Explicitly unchanged:** emitted block geometry (blocks are never padded, only spaced); no buffer
at working-window edges; manual paths (`POST /schedule`, `PATCH /schedule/:id`, `/start`, `/stop`)
still accept any user-chosen time verbatim — the user's explicit action wins; only the *scheduler*
keeps its distance.

**Tests (currently zero coverage for all of these):** auto-after-pinned gap, auto-before-pinned
gap, leading-gap between two auto blocks under constrained ordering, task↔habit adjacency,
`gapMs=0` regression, meetings still governed solely by `meetingBufferMs`.

## B. Habit blocks are stable across replans (sticky, not pinned)

**Current behavior.** Every replan re-derives habit placements from scratch; unrelated task churn
can move habit blocks around the week.

**Change.** Thread each habit occurrence's existing block into the engine as its *preferred exact
slot*:
- `core/assemble.ts` collects the user's existing non-pinned habit blocks in the horizon and
  attaches them to the engine `Habit` (e.g. `existingSlots: Interval[]`).
- `scheduler/items.ts (scheduleHabit)`: for each occurrence, first try to keep an existing slot
  verbatim — valid iff the slot still lies inside the habit's allowed window for that period and
  fits entirely in remaining free time (which, per item A, includes buffer padding). If valid,
  emit the identical interval (stable engineKey ⇒ `applyDesiredSchedule` diff is a no-op). Only
  invalidated occurrences are re-placed normally.
- Dragging a habit block still pins it (unchanged); pinned habit blocks remain user-managed.

**Invariant:** a replan that does not invalidate a habit slot leaves that block byte-identical.

**Tests:** slot kept across replan with unrelated task churn; slot re-placed when a new event
overlaps it; slot re-placed when it fell outside the allowed window; sticky slot still respects
item-A buffers; drag-pin still wins.

## C. App-created calendar events: drag + edit drawer, Google write-back

**Current behavior.** Events created via the click-to-create popover become `CalendarEvent` rows
(and are inserted into the user's primary Google calendar when connected), but render as static
`EventBlock`s — no way to move or edit them afterwards. Delete already exists
(`DELETE /calendar/events/:id`).

**Data model.** `CalendarEvent` has no origin marker — after write-back an app-created event is
indistinguishable from a mirrored Google one. Add `source` (`app` | `google`, default `google`)
via Prisma migration; `POST /calendar/events` sets `app`, the sync path sets/keeps `google`.
Pre-existing rows default to `google` and thus stay read-only — acceptable one-time cost; the
user recreates any old app event they want editable.

**Server.** New `PATCH /calendar/events/:id` (zod: optional `title`, `startsAt`, `endsAt`;
`endsAt > startsAt`): 404 unless the event belongs to the user **and** `source === 'app'`;
updates the row; when Google-connected and the row has a `googleEventId`, patches the Google
event (new `patchEvent` on the google client, mirroring `insertEvent`/`deleteEvent`); fires
`afterMutation` so the schedule replans around the moved busy time. Google patch failures follow
the existing local-first pattern (local update succeeds; sync reconciles later).

**Web.** `EventBlock`s with `source === 'app'` become interactive: same drag/move/resize + 15-min
snap machinery as `InteractiveBlock` (reuse, not fork), committing via the new PATCH with
optimistic mutation; click opens an event edit drawer (design-system style, matching the task
drawer: title, date, start/end, delete) via `useClickOutside`. Mirrored Google events stay
read-only exactly as today.

**Tests:** route authz (`google`-source and foreign-user 404), validation, Google patch called
only when connected, replan fired; web — drag commits PATCH, drawer edits/deletes, read-only for
mirrored events.

## D. Habits occur at most once per calendar day

**Current behavior.** `perPeriod` occurrences are placed anywhere inside the weekly period;
nothing prevents two occurrences of the same habit on the same day, and users see duplicates.

**Change.** In `scheduleHabit`, after placing (or keeping, per item B) an occurrence inside an
allowed-window entry, exclude that entire entry from the habit's remaining windows for the rest
of the period. `expandHabit` already emits day-granular `allowedWindows` in the user's timezone,
so "one per allowed window" ≡ "one per calendar day" with no timezone logic in the engine. If
`perPeriod` exceeds the eligible days available, the surplus counts as missed (existing at-risk
reporting unchanged). UI/model unchanged — `perPeriod` still means "times per week".

**Tests:** perPeriod=3 with 7 free eligible days → 3 distinct days; perPeriod=3 with 2 eligible
days → 2 placed + 1 missed; interaction with sticky slots (kept slot consumes its day); duplicate
same-day blocks from pre-change plans are migrated away naturally by the next replan.

## Out of scope
- Unifying `taskBufferMs`/`meetingBufferMs` into one knob (candidate for a later review).
- Editing mirrored Google events from the app.
- Buffer enforcement on manual placement paths.
- Per-habit "times per day" configuration.

## Sequencing
A (scheduler invariant) → D (engine, builds on A's placement changes) → B (core+engine sticky
slots) → C (independent full-stack slice; can proceed in parallel with B).
