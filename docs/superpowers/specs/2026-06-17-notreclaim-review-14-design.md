# NotReclaim — Review 14: Stop the running task (design)

Date: 2026-06-17

## Goal

Add a **Stop** action that ends the currently-running task now, and turn the top-bar
task widget into a **current-or-next** widget. This also resolves the "a started task
still shows as started after I move its end before now" issue.

(Items "I don't see the hide buttons" were a Vite dev-server staleness issue — the
sidebar/panel hide toggles from Review 13 already exist; a cache-clear + restart fixed
the served bundle, no code change. The "Today" button resets the today-anchored window
after paging with ‹/›. Neither is part of this spec.)

## User-confirmed behaviour

- **Stop ends the running task now:** pressing Stop sets the block's **end to the
  current time, snapped to the nearest 15 min**, keeping the start (the symmetric
  inverse of Start, which pulls the start to now).
- **The widget is current-or-next:** when a task is running it shows that task with a
  **Stop** button; otherwise it shows the next upcoming task with **Start** (as today).
- **"Running" = a task block you Started that still spans now** (`startedAt != null`
  **and** `start ≤ now < end`). A started block whose end is dragged before now no
  longer satisfies `now < end`, so it stops being "running" — it's just a finished,
  counted block. This is what fixes the "still shows as started" complaint.

## Non-goals

- No change to spent/left computation, the manual/auto modes, or the Start endpoint.
- `startedAt` is never cleared (a stopped block is a finished *started* block; in manual
  mode it still counts its now-shorter actual time toward "spent").
- No new persistence; no change to the sidebar/panel hide toggles or the Today button.

## Server — `POST /schedule/:id/stop`

Mirrors `POST /schedule/:id/start`:

1. Load the block via `scheduledBlocks.findById(userId, id)`; 404 if missing; 400 if it
   has no `taskId` (habit block).
2. `snapped = round15(now)`. Compute the new end clamped so it never goes zero-length or
   extends past the original end:
   ```ts
   const startMs = block.startsAt.getTime();
   const endMs = block.endsAt.getTime();
   const MIN = 15 * 60 * 1000;
   const newEnd = Math.min(endMs, Math.max(snapped, startMs + MIN));
   ```
3. Update `{ endsAt: new Date(newEnd), pinned: true }` (start unchanged; `startedAt`
   untouched). `afterMutation(userId)` so reconcile reclaims the freed tail.
4. Return the updated block.

`round15` is already exported from `@notreclaim/core` and imported by `schedule-routes.ts`.

## Web API

- `client.ts`: `stopBlock(id: string): Promise<ScheduledBlock>` → `POST /schedule/${id}/stop`
  (add to the `ApiClient` interface + impl; add a `notImplemented('stopBlock')` default to
  `fakeApiClient`).
- `queries.ts`: `useStopBlockMutation` — invalidates `queryKeys.scheduleRoot` and
  `queryKeys.tasksRoot` (identical shape to `useStartBlockMutation`).

## Top-bar widget (`TopBar.tsx`)

Replace the next-only widget with current-or-next. Using `useScheduleQuery` data and
`useStartBlockMutation` + `useStopBlockMutation`:

```ts
const tasks = (scheduleQ.data ?? []).filter((b) => b.taskId != null);
const running = tasks
  .filter((b) => b.startedAt != null && Date.parse(b.startsAt) <= nowMs && Date.parse(b.endsAt) > nowMs)
  .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
const next = running ? null : tasks
  .filter((b) => Date.parse(b.startsAt) > nowMs)
  .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
```

- **Running:** show `data-testid="current-task"` reading `Now: {running.title}` (clock
  icon) + a `data-testid="stop-task"` button (label "Stop") → `stopBlock.mutate(running.id)`.
- **Next:** show the existing `data-testid="next-task"` (`Next: {title} · {relativeDayTimeLabel}`)
  + `data-testid="next-task-start"` button → `startBlock.mutate(next.id)`.
- Neither → render nothing. The old `next-task-started` branch is removed.

## Testing

- **Server** (`schedule.test.ts`): `POST /schedule/:id/stop` snaps the end to `round15(now)`
  keeping start (e.g. block 23:00→01:00 with FIXED_NOW 00:00 → end 00:00, start unchanged);
  never extends past the original end; floors to `start + 15 min` when `round15(now)` lands
  at/before the start; 404 unknown; 400 habit block.
- **Web** (`TopBar.test.tsx`): a running started block (`startedAt` set, spanning now) →
  shows `current-task` + `stop-task`, click calls `stopBlock` with its id; no running block
  → shows `next-task` + `next-task-start`; a started block whose `endsAt ≤ now` is NOT shown
  as running (falls through to next/none).
- Tests per-package; web with `TZ=UTC`. Live-verify via geckodriver: Start a now-spanning
  block → widget flips to "Now … Stop" → Stop ends it (end snaps to now, widget clears).

## Edge cases

- `round15(now)` can round up to ~7 min past now; for a running block that's still `< end`,
  so the new end is valid and the block resolves out of "running" within the next quarter
  hour. Acceptable.
- Stop on a block that already ended (`now ≥ end`) can't happen from the UI (only running
  blocks show Stop); the clamp `min(endMs, …)` would no-op the end anyway.
- Manual mode: a stopped block is finished + started → counts its shortened duration; Stop
  thus makes "spent" reflect the real time worked.
