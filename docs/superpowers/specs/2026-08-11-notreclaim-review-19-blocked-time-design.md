# NotReclaim Review 19 — blocked time (local-only busy blocks)

**Date:** 2026-08-11 · **Status:** approved (user: one-off planner blocks; protect against tasks AND habits)

## Goal
A planner-created "Blocked" entry (relax/personal time): consumes free time so nothing is
auto-scheduled into it (tasks and habits alike), and is **never** written to Google Calendar.

## Design — a `kind` on CalendarEvent (reuse, not a new model)
A blocked entry is a `CalendarEvent` that skips Google write-back. Everything else — busy-time
subtraction in the engine, drag/resize, edit drawer, delete, optimistic mutations, resync
survival (`source: 'app'` rows are spared by the R17 purge fix) — already works for app events.

1. **db:** enum `CalendarEventKind { event blocked }`; `CalendarEvent.kind @default(event)` +
   migration. Repo `create` accepts `kind`.
2. **server:** `POST /calendar/events` body gains optional `kind` (`'event' | 'blocked'`,
   default `'event'`); when `blocked`, SKIP the Google insert entirely (no access-token attempt
   → no warn-log noise). PATCH/DELETE need no change: blocked rows have `source: 'app'` and no
   google ids, so the existing google-ids guards already skip remote calls. GET returns `kind`.
3. **core (one semantic decision):** blocked entries are subtracted from free time **raw** —
   `meetingBufferMs` inflation applies only to `kind: 'event'`. Rationale: the meeting buffer
   is prep/decompress time around meetings; padding a relax block is not wanted. (assemble's
   event→FixedEvent mapping filters which rows get inflated.)
4. **web:** CreatePopover gets a third type toggle `Blocked` (title optional, default
   "Blocked"); POSTs with `kind: 'blocked'`. Rendering: blocked blocks use a muted/hatched
   style distinct from blue events (design-system: gray tone, e.g. `bg-slate-100
   border-slate-300 text-slate-500` with the existing block shape) — still interactive via the
   R17 event machinery (drag/resize/edit drawer/delete). Type is NOT editable after creation
   (drawer shows title/times only, as for events).

## Non-goals
Recurring weekly off-hours (revisit if wanted); hiding blocked entries from the app planner
(they must be visible to be manageable); Google sync of blocked time in any form.

## Tests
db: kind persisted, default `event`. server: POST blocked → 201, no google insert attempted
even when connected, `afterMutation` fired; POST event unchanged. core: blocked event NOT
inflated by meetingBufferMs while a plain event is; engine receives both as busy. web:
popover third toggle POSTs kind blocked; blocked block renders muted + draggable; drawer
edits/deletes a blocked entry.
