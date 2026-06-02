# NotReclaim — Scheduling Buffers (Review 1, Milestone E) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` item #1 — *"I want to configure buffers between meetings. Doesn't need
to be a separate tab."* (clarified to also cover gaps between auto-scheduled task/habit blocks.)
**Builds on:** the assemble-layer `FixedEvent`/`busy` pipeline and the scheduler's `placeItem` greedy
placer.

## Summary

Add two configurable, independently-settable scheduling **buffers**, both in the existing Settings
"Scheduling" section (no new tab), both defaulting to **0** (= today's behavior):

1. **Buffer around meetings** (`meetingBufferMs`) — the scheduler keeps this much time free before/after
   each Google-calendar meeting. Applied by **padding each calendar `FixedEvent` in `assemble`** (the
   engine already subtracts `fixedEvents` from free time) — no engine change for this part.
2. **Break between tasks** (`taskBufferMs`) — a minimum gap between consecutive auto-scheduled
   task/habit blocks. Applied by a small **scheduler-engine change**: a new `ScheduleInput.blockBufferMs`
   threaded to `placeItem`, which reserves `[start, end + gap]` of free time after each placed block.

Meetings still render at their true times on the Planner (the meeting buffer affects only *placement*,
not the displayed event).

## Goals

- Two `Int` Settings fields (`meetingBufferMs`, `taskBufferMs`), default 0, edited in the Settings
  Scheduling section as minute inputs.
- Meeting buffer: no task/habit block is placed within `meetingBufferMs` of a calendar meeting.
- Task break: ≥ `taskBufferMs` of free time between any two consecutive auto-scheduled task/habit blocks
  (including a task's own split chunks).
- Deterministic tests at every layer; fully backward-compatible (0 = unchanged scheduling).

## Non-Goals

- **No before/after split** — the meeting buffer is a single symmetric value (pad both sides equally).
- **No per-category / per-task / per-meeting buffer overrides** — two global values only.
- **No travel-time / decompression / per-meeting-type buffers** — out of scope.
- The meeting buffer does **not** pad pinned task/habit blocks (only calendar meetings); the task break
  does **not** apply around meetings (the meeting buffer covers meeting-adjacency).
- No change to how meetings are displayed on the Planner (true times, unpadded).

## Decisions (locked during brainstorming)

- **Two independent settings** (`meetingBufferMs`, `taskBufferMs`), not one shared value — they are
  semantically different and users may want different amounts.
- **Meeting buffer = assemble-time pad of `FixedEvent`s** (`{start − buf, end + buf}`); the engine's
  existing `busy = merge(fixedEvents + pinnedBlocks)` then keeps the buffer free. No engine change.
- **Task break = engine change, "gap-after" model (Approach A).** Add `ScheduleInput.blockBufferMs`;
  thread to `placeItem`; after placing `[s, e]`, subtract `[s, e + gap]` from remaining free. Because
  placement is greedy earliest-first, reserving the gap *after* each block guarantees ≥ `gap` between
  any two consecutive placed blocks. The placement is still reported as `[s, e]`; only free-time
  consumption is padded. (Rejected Approach B — post-processing/shifting placed blocks — as fragile.)
- **Defaults 0** everywhere → `blockBufferMs = 0` and unpadded meetings = byte-for-byte today's behavior.
- **The task break also spaces a single task's own split chunks** (consecutive work blocks get a break)
  — accepted as correct.

## Architecture / Components

### Engine — `@notreclaim/scheduler`
- `types.ts`: `ScheduleInput` gains `blockBufferMs?: number` (optional; treated as 0 when absent;
  doc-comment: "minimum free gap reserved after each placed task/habit block").
- `placement.ts` `placeItem(free, chunkSizes, deadline, candidateWindows?, gapMs = 0)`: after pushing a
  `placement`, subtract `[{ start: placement.start, end: placement.end + gapMs }]` from `remainingFree`
  (instead of `[placement]`). `gapMs = 0` → identical to today. The slot-fit/deadline checks are
  unchanged (the gap is reserved *after* the block, not part of it).
- `items.ts`: `scheduleTask(free, task, gapMs = 0)` passes `gapMs` to its `placeItem` call;
  `scheduleHabit(free, habit, gapMs = 0)` passes `gapMs` to **both** of its `placeItem` calls (primary
  + fallback).
- `schedule.ts`: pass `input.blockBufferMs ?? 0` into `scheduleTask` / `scheduleHabit`.

### Assembly — `@notreclaim/core`
- Read `meetingBufferMs` and `taskBufferMs` from settings (both default 0 when null/absent).
- **Meeting pad:** build `fixedEvents` as
  ```ts
  const meetingBufferMs = settings.meetingBufferMs ?? 0;
  const fixedEvents: FixedEvent[] = events.map((e) => {
    const fe = toFixedEvent(e);
    return meetingBufferMs > 0 ? { id: fe.id, start: fe.start - meetingBufferMs, end: fe.end + meetingBufferMs } : fe;
  });
  ```
- **Block buffer:** set `blockBufferMs: settings.taskBufferMs ?? 0` on the returned `ScheduleInput`.
- Nothing else changes (pinned blocks, tasks, habits, envelope unchanged).

### Data model — `@notreclaim/db`
- `Settings` gains `meetingBufferMs Int @default(0)` and `taskBufferMs Int @default(0)` (additive,
  non-null with default; existing rows get 0). Prisma migration.
- `UpsertSettingsInput` gains `meetingBufferMs?: number` and `taskBufferMs?: number` (optional; Prisma
  defaults to 0 when omitted on create).

### Server — `@notreclaim/server`
- `settingsSchema` gains `meetingBufferMs: z.number().int().nonnegative().optional()` and
  `taskBufferMs: z.number().int().nonnegative().optional()`. The `PUT /settings` handler already spreads
  the parsed body into the upsert, so no handler change beyond the schema.

### Web — `@notreclaim/web`
- `api/types.ts`: `Settings` and `SettingsInput` gain `meetingBufferMs: number` / `taskBufferMs: number`
  (and `?` optional on `SettingsInput` to match the schema; `Settings` always carries them).
- `app/settings/settingsForm.ts`: `SettingsFormState` gains `meetingBufferMs: number` and
  `taskBufferMs: number`, **both held in milliseconds** (uniform with the existing `defaultMin/MaxChunkMs`
  state); `toFormState` reads them (`?? 0`); `defaultFormState` sets `0`/`0`; `toSettingsInput` emits them
  (ms, pass-through); `validateSettingsForm` requires each to be a non-negative integer (`>= 0`).
- `app/settings/SettingsForm.tsx`: two **minute** number inputs in the **Scheduling** `<section>` —
  "Buffer around meetings" (`data-testid="meeting-buffer"`) and "Break between tasks"
  (`data-testid="task-buffer"`), styled like the existing horizon input. Each shows minutes
  (`value={Math.round(form.<field> / 60_000)}`) and writes ms on change
  (`setForm((f) => ({ ...f, <field>: Number(e.target.value) * 60_000 }))`). So the wire/DTO/db value is
  always ms; only the input widget is in minutes.

## Data flow

Settings form (minutes) → `meetingBufferMs`/`taskBufferMs` (ms) → `PUT /settings` upsert →
`assemble` reads them → meeting `FixedEvent`s padded by `meetingBufferMs` + `ScheduleInput.blockBufferMs`
= `taskBufferMs` → `schedule()`: padded meetings expand `busy` (tasks avoid the meeting buffer) and
`placeItem` reserves `taskBufferMs` after each placed block (tasks keep their break) → committed/preview
blocks reflect both buffers. Re-plan runs through the existing `afterMutation` hook on settings save.

## Error handling

- Server: negative or non-integer buffer → `400` (zod). Absent → upsert omits it → Prisma default 0.
- Over-large buffers that crowd out tasks → those tasks land in the At-risk panel (existing mechanism);
  no special validation (consistent with over-constrained working hours / categories).

## Testing (vitest; `TZ=UTC`; no real Google; Postgres for `@notreclaim/db`)

- **Engine (`scheduler`):** `placeItem` with `gapMs` reserves the gap after a placement so the next chunk
  starts ≥ `gap` later (free = `[0,100]`, two size-20 chunks, gap 10 → placements at 0–20 and 30–50);
  `gapMs = 0` is byte-for-byte the old behavior (regression); `scheduleTask`/`scheduleHabit` thread
  `gapMs`; `schedule()` spaces two tasks by `blockBufferMs`.
- **`core/assemble`:** with `meetingBufferMs > 0`, a calendar event `[10:00,11:00]` becomes a busy
  `FixedEvent` `[09:45,11:15]` (buffer 15m) so a task can't be placed at 09:50 or 11:05; `blockBufferMs`
  on the output equals `settings.taskBufferMs`; both default 0 when settings omit them (no-op,
  backward-compatible — existing assemble tests unchanged).
- **`db` settings-repository** (real Postgres): upsert round-trips `meetingBufferMs`/`taskBufferMs`;
  omitted → 0.
- **Server:** `PUT /settings` accepts + persists both; negative → 400.
- **Web:** `settingsForm` round-trips both (form minutes ↔ ms; validation rejects negatives);
  `SettingsForm` renders + edits the two inputs.
- Full monorepo suite (Postgres up) + `npm run build -w @notreclaim/web` green.

## Scope / decomposition (for the plan)

~6 sequential TDD tasks:
1. **Engine:** `ScheduleInput.blockBufferMs` + `placeItem` `gapMs` reservation + `scheduleTask`/
   `scheduleHabit`/`schedule` threading + tests.
2. **DB:** `Settings.meetingBufferMs`/`taskBufferMs` migration + `UpsertSettingsInput` + repo test.
3. **Core:** `assemble` meeting-pad + `blockBufferMs` from `taskBufferMs` + tests (and fakes/`makeSettings`
   updated to carry the new fields).
4. **Server:** `settingsSchema` two fields + tests.
5. **Web:** `Settings`/`SettingsInput` DTOs + `settingsForm` state/validation/conversions + `SettingsForm`
   two inputs + tests.
6. **Verification:** full monorepo suite (Postgres up) + web build; whole-branch review.
