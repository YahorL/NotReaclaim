# Review 17 Implementation Plan — buffers, sticky habits, editable app events, once-per-day habits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `taskBufferMs` a two-sided invariant (incl. around pinned blocks), cap habits at one occurrence per day, keep habit blocks stable across replans, and let users drag/edit calendar events they created in the app (with Google write-back).

**Architecture:** Items A/D/B are engine+core changes (pure functions, TDD-friendly): `placement.ts` reserves gap on both sides, `schedule.ts` pads pinned busy intervals, `scheduleHabit` consumes one allowed-window day per occurrence and prefers `existingSlots` threaded in by `assemble.ts`. Item C is a full-stack slice: Prisma `source` column → `PATCH /calendar/events/:id` (reusing `googleClient.updateEvent`) → interactive event blocks + edit drawer in the planner.

**Tech Stack:** TypeScript ESM monorepo, vitest, Prisma/Postgres, Fastify+zod, React 18 + TanStack Query + Tailwind v3.

**Spec:** `docs/superpowers/specs/2026-08-11-notreclaim-review-17-design.md`

## Global Constraints

- Backend relative imports use explicit `.js`; `packages/web` imports are EXTENSIONLESS and NEVER `import React` (named hook imports fine).
- Tailwind v3 literal utility class strings only.
- Pure modules take `now`/times as parameters — no `Date.now()` outside impure shells.
- Per-package tests: `npm test -w @notreclaim/<pkg>`; single file: `npm test -w @notreclaim/<pkg> -- <path>`. Web tests already pin `TZ=UTC`.
- `@notreclaim/db` tests need the userspace Postgres on `/tmp:5432` (`~/.local/pgdata`) and `packages/db/.env.test`.
- Do NOT commit: `seed-dev.mjs`, `.env.run`, `packages/db/.env*`, `review/`, `design_handoff_notreclaim/`.
- Subagents: NEVER run branch-switching/history git commands (`checkout`, `switch`, `reset`, `rebase`, `stash`). Commit on the current branch only, staging only the files you touched.
- After engine/core changes, dependents compile against `dist/`: run `npm run build -w @notreclaim/<pkg>` for the changed package before testing a dependent package.

---

### Task 1: Two-sided gap reservation in `placeItem`

**Files:**
- Modify: `packages/scheduler/src/placement.ts:73`
- Test: `packages/scheduler/test/placement.test.ts`

**Interfaces:** `placeItem(free, chunkSizes, deadline, candidateWindows?, gapMs=0)` — signature unchanged. New semantics: each placement consumes `[start − gapMs, end + gapMs]` of free time.

- [ ] **Step 1: Write failing tests** (append to placement.test.ts; hours as ms helpers already exist in the file — follow its local style):

```ts
it('reserves the gap on both sides of a placement', () => {
  // free: 09:00–18:00, place 1h chunk, then another 1h chunk with a window
  // forcing it BEFORE a later reserved region is irrelevant here; simplest probe:
  // place one chunk, then assert the free timeline lost [start-gap, end+gap].
  const H = 3_600_000, G = 900_000; // 1h, 15m
  const free = [{ start: 9 * H, end: 18 * H }];
  const res = placeItem(free, [H], 24 * H, undefined, G);
  expect(res.placements).toEqual([{ start: 9 * H, end: 10 * H }]);
  // leading side is clipped by the interval edge; trailing side reserved:
  expect(res.free).toEqual([{ start: 10 * H + G, end: 18 * H }]);
});

it('keeps a later placement from touching an earlier one from the left', () => {
  const H = 3_600_000, G = 900_000;
  const free = [{ start: 9 * H, end: 18 * H }];
  // First: confined to 12:00+ via candidate window.
  const first = placeItem(free, [H], 24 * H, [{ start: 12 * H, end: 18 * H }], G);
  expect(first.placements[0]).toEqual({ start: 12 * H, end: 13 * H });
  // Second: unconstrained — earliest slot must END by 12:00 − 15m.
  const second = placeItem(first.free, [2 * H], 24 * H, undefined, G);
  expect(second.placements[0]).toEqual({ start: 9 * H, end: 11 * H });
  expect(first.free[0]!.end).toBe(12 * H - G); // leading gap reserved
});
```

- [ ] **Step 2:** `npm test -w @notreclaim/scheduler -- test/placement.test.ts` → both FAIL (today only `end + gapMs` is subtracted).
- [ ] **Step 3: Implement** — one line in `placeItem`:

```ts
remainingFree = subtractIntervals(remainingFree, [
  { start: placement.start - gapMs, end: placement.end + gapMs },
]);
```

- [ ] **Step 4:** Run the full scheduler suite: `npm test -w @notreclaim/scheduler` — new tests PASS; pre-existing gap tests (inter-chunk spacing, `gapMs=0` regression) still PASS. If an existing test asserted the exact old free-timeline shape, update it only to reflect the two-sided reservation — never weaken a gap assertion.
- [ ] **Step 5:** `npm run build -w @notreclaim/scheduler` then commit: `fix(scheduler): reserve taskBuffer gap on both sides of each placement`

### Task 2: Pad pinned blocks in `schedule()` busy set

**Files:**
- Modify: `packages/scheduler/src/schedule.ts:24-29`
- Test: `packages/scheduler/test/schedule.test.ts`

**Interfaces:** `schedule(input: ScheduleInput)` unchanged. New semantics: pinned blocks subtract `[start − blockBufferMs, end + blockBufferMs]` from free; fixed events stay RAW (meeting padding remains `meetingBufferMs`'s job in core).

- [ ] **Step 1: Write failing tests:**

```ts
it('keeps blockBufferMs distance on both sides of a pinned block', () => {
  const H = 3_600_000, G = 900_000;
  const res = schedule({
    workingWindows: [{ start: 9 * H, end: 18 * H }],
    fixedEvents: [],
    pinnedBlocks: [{ id: 'pin', sourceType: 'task', sourceId: 'p', title: 'P', start: 11 * H, end: 12 * H }],
    tasks: [
      { id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H },
      { id: 'b', title: 'B', priority: 2, durationMs: 4 * H, dueBy: 24 * H, minChunkMs: 4 * H, maxChunkMs: 4 * H },
    ],
    habits: [],
    blockBufferMs: G,
  });
  const auto = res.blocks.filter((b) => b.id !== 'pin');
  for (const b of auto) {
    expect(b.end <= 11 * H - G || b.start >= 12 * H + G).toBe(true);
  }
});

it('does not apply blockBufferMs to fixed events', () => {
  const H = 3_600_000, G = 900_000;
  const res = schedule({
    workingWindows: [{ start: 9 * H, end: 18 * H }],
    fixedEvents: [{ id: 'e', title: 'E', start: 11 * H, end: 12 * H }],
    pinnedBlocks: [],
    tasks: [{ id: 'a', title: 'A', priority: 1, durationMs: 2 * H, dueBy: 24 * H, minChunkMs: 2 * H, maxChunkMs: 2 * H }],
    habits: [],
    blockBufferMs: G,
  });
  expect(res.blocks[0]).toMatchObject({ start: 9 * H, end: 11 * H }); // flush against event is allowed
});
```

(Adapt field names to the real `ScheduleInput`/`FlexibleTask` shapes in `types.ts` — copy an existing test's fixture style.)

- [ ] **Step 2:** Run → first FAILS (task lands flush at 12:00), second PASSES already (guards the boundary we're keeping).
- [ ] **Step 3: Implement** in `schedule()`:

```ts
const gapMs = input.blockBufferMs ?? 0;
const busy = mergeIntervals([
  ...input.fixedEvents.map((e) => ({ start: e.start, end: e.end })),
  ...input.pinnedBlocks.map((b) => ({ start: b.start - gapMs, end: b.end + gapMs })),
]);
```

(Then use the same `gapMs` const in the work loop instead of re-reading `input.blockBufferMs`.) Pinned blocks are still pushed to `blocks` VERBATIM — only the busy set is padded.

- [ ] **Step 4:** `npm test -w @notreclaim/scheduler` → all pass.
- [ ] **Step 5:** Build + commit: `fix(scheduler): keep taskBuffer distance around pinned blocks`

### Task 3: One habit occurrence per day

**Files:**
- Modify: `packages/scheduler/src/items.ts` (`scheduleHabit`)
- Test: `packages/scheduler/test/items.test.ts`

**Interfaces:** `scheduleHabit(free, habit, gapMs)` unchanged. New semantics: within a period, after an occurrence is placed inside an `allowedWindows` entry, that ENTIRE entry is excluded from the habit's remaining placements (all periods — entries are day-granular and period-disjoint anyway). Habits without `allowedWindows` are exempt (core always supplies them).

- [ ] **Step 1: Failing tests:**

```ts
it('places at most one occurrence per allowed-window day', () => {
  const D = 86_400_000, H = 3_600_000;
  const habit: Habit = {
    id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 3,
    periods: [{ start: 0, end: 7 * D }],
    allowedWindows: [0, 1, 2, 3, 4].map((d) => ({ start: d * D + 9 * H, end: d * D + 17 * H })),
  };
  const res = scheduleHabit([{ start: 0, end: 7 * D }], habit, 0);
  const days = res.blocks.map((b) => Math.floor(b.start / D));
  expect(res.blocks).toHaveLength(3);
  expect(new Set(days).size).toBe(3); // three DISTINCT days
});

it('reports surplus occurrences as missed when eligible days run out', () => {
  const D = 86_400_000, H = 3_600_000;
  const habit: Habit = {
    id: 'h', title: 'H', priority: 1, chunkMs: H, perPeriod: 3,
    periods: [{ start: 0, end: 7 * D }],
    allowedWindows: [0, 1].map((d) => ({ start: d * D + 9 * H, end: d * D + 17 * H })),
  };
  const res = scheduleHabit([{ start: 0, end: 7 * D }], habit, 0);
  expect(res.blocks).toHaveLength(2);
  expect(res.unscheduled[0]?.remainingMs).toBe(H); // 1 occurrence missed — match the existing missed-reporting shape in items.ts
});
```

(Check how `missed` is surfaced in `ScheduleItemResult` and assert that exact shape.)

- [ ] **Step 2:** Run → first test FAILS today (all 3 can pile onto day 0 when free).
- [ ] **Step 3: Implement** inside `scheduleHabit`: maintain `let remainingAllowed = habit.allowedWindows` and `let remainingPreferred = habit.preferredWindows`. Compute `bound`/`preferred` from these instead of the habit fields. After each successful placement `p`, remove the consumed day:

```ts
if (habit.allowedWindows) {
  const day = remainingAllowed!.find((w) => p.start >= w.start && p.start < w.end);
  if (day) {
    remainingAllowed = remainingAllowed!.filter((w) => w !== day);
    if (remainingPreferred) {
      remainingPreferred = subtractIntervals(remainingPreferred, [day]);
    }
  }
}
```

- [ ] **Step 4:** Full scheduler suite. An existing test may legitimately break if it asserted two same-day occurrences — update its fixture to spread eligible days (that behavior is the bug being fixed); any other breakage is a real regression.
- [ ] **Step 5:** Build + commit: `feat(scheduler): cap habits at one occurrence per allowed day`

### Task 4: Sticky habit slots in the engine

**Files:**
- Modify: `packages/scheduler/src/types.ts` (Habit), `packages/scheduler/src/items.ts` (`scheduleHabit`)
- Test: `packages/scheduler/test/items.test.ts`

**Interfaces — Produces (Task 5 depends on this):** `Habit.existingSlots?: Interval[]` — prior placements for this habit, sorted by `start`. `scheduleHabit` keeps each slot verbatim when still valid; kept slots consume occurrence count, free time (with gap), and their day (Task 3).

- [ ] **Step 1: Failing tests:**

```ts
it('keeps a valid existing slot verbatim', () => {
  const D = 86_400_000, H = 3_600_000;
  const habit: Habit = { /* as Task 3 fixture, perPeriod: 2 */
    existingSlots: [{ start: 1 * D + 13 * H, end: 1 * D + 14 * H }],
  };
  const res = scheduleHabit([{ start: 0, end: 7 * D }], habit, 0);
  expect(res.blocks.map((b) => ({ start: b.start, end: b.end }))).toContainEqual(
    { start: 1 * D + 13 * H, end: 1 * D + 14 * H },
  );
  expect(res.blocks).toHaveLength(2); // kept slot counts toward perPeriod
});

it('re-places a slot that no longer fits in free time', () => {
  // same habit, but free excludes the slot: [{start:0,end:1*D}, {start:2*D,end:7*D}]
  // → block count still 2, none equal to the stale slot interval.
});

it('kept slot consumes its day (no second occurrence that day)', () => {
  // perPeriod 2, existing slot on day 1 → assert the other block is NOT on day 1.
});
```

- [ ] **Step 2:** Run → fail (`existingSlots` unknown / ignored).
- [ ] **Step 3: Implement.** In `types.ts` add `existingSlots?: Interval[]` with a doc comment. In `scheduleHabit`, per period, BEFORE the placement loop: for each `slot` of `habit.existingSlots ?? []` with `slot.start >= period.start && slot.end <= period.end`, while occurrences remain: valid iff (a) fully contained in one interval of `intersectIntervals(remainingFree, bound)`, i.e. subtracting it from that intersection removes exactly `[slot.start, slot.end]`; simplest check: `intersectIntervals(remainingFree, bound)` has an interval `iv` with `iv.start <= slot.start && iv.end >= slot.end`. If valid: push block `{ id: habit:${habit.id}:${index++}, sourceType:'habit', sourceId:habit.id, title:habit.title, start:slot.start, end:slot.end }`, subtract `[slot.start − gapMs, slot.end + gapMs]` from `remainingFree`, consume the day (Task 3 mechanism), decrement remaining target. Invalid slots are skipped silently. Then run the normal placement loop for the remaining target.
- [ ] **Step 4:** Full scheduler suite green.
- [ ] **Step 5:** Build + commit: `feat(scheduler): keep valid existing habit slots across replans`

### Task 5: Assemble threads existing habit slots

**Files:**
- Modify: `packages/core/src/assemble.ts` (habit expansion call site), `packages/core/src/habit-expansion.ts` (accept + attach slots)
- Test: `packages/core/test/assemble.test.ts`

**Interfaces — Consumes:** `Habit.existingSlots` from Task 4. **Produces:** `expandHabit(habit, timezone, now, horizonDays, existingSlots?: Interval[])` — 5th optional param, attached to the returned engine habit when non-empty.

- [ ] **Step 1: Failing test** (assemble.test.ts uses in-memory fake repos — follow the file's existing fixture builders):

```ts
it('threads non-pinned future habit blocks into the engine habit as existingSlots', async () => {
  // seed scheduledBlocks fake with: one non-pinned block for habit h1 starting tomorrow,
  // one PINNED block for h1, one non-pinned block in the past, one non-pinned TASK block.
  const input = await assembleScheduleInput(repos, userId, now);
  const engineHabit = input.habits.find((h) => h.id === 'h1')!;
  expect(engineHabit.existingSlots).toEqual([{ start: tomorrowStart, end: tomorrowEnd }]);
});
```

- [ ] **Step 2:** Run → fails (`existingSlots` undefined).
- [ ] **Step 3: Implement.** In `assemble.ts`, the existing blocks list is already fetched for the pinned split — from it, per habit: `blocks.filter((b) => b.habitId === habit.id && !b.pinned && b.startedAt == null && b.startsAt.getTime() >= now)`, map to `{ start: b.startsAt.getTime(), end: b.endsAt.getTime() }`, sort by `start`, pass to `expandHabit`. In `habit-expansion.ts`: `if (existingSlots && existingSlots.length > 0) result.existingSlots = existingSlots;`
- [ ] **Step 4:** `npm test -w @notreclaim/core` green; `npm run build -w @notreclaim/core`.
- [ ] **Step 5:** Commit: `feat(core): feed existing habit block times to the engine for sticky replans`

### Task 6: `CalendarEvent.source` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (CalendarEvent), `packages/db/src/repositories/calendar-event-repository.ts`, `packages/db/src/mappers.ts` + `packages/db/src/index.ts` (type export) if the row type is hand-declared
- Migration: `npm run prisma:migrate -w @notreclaim/db -- --name calendar_event_source` (userspace Postgres must be running; start per `~/.local/pgdata` if `pg_isready -h /tmp` fails)
- Test: `packages/db/test/repositories/calendar-event-repository.test.ts`

**Interfaces — Produces (Task 7/8 depend on this):** `CalendarEvent.source: 'app' | 'google'`; `create()` writes `source: 'app'`; the sync/upsert path writes `source: 'google'`.

- [ ] **Step 1:** Schema:

```prisma
enum CalendarEventSource {
  app
  google
}
// in CalendarEvent:
source CalendarEventSource @default(google)
```

- [ ] **Step 2: Failing tests** (integration, follows existing repo test style): `create()` → row has `source: 'app'`; the sync-path upsert method (find its exact name in the repository — the one keyed on `(googleCalendarId, googleEventId)`) → `source: 'google'`.
- [ ] **Step 3:** Run migration, implement: `create()` adds `source: 'app'`; verify the upsert path relies on the default / sets `'google'` explicitly on create-branch. Do NOT overwrite `source` on upsert-update (an app event that was written back and later mirrored must stay `'app'` — guard: upsert update branch never touches `source`).
- [ ] **Step 4:** `npm test -w @notreclaim/db` green (needs local pg). `npm run build -w @notreclaim/db`.
- [ ] **Step 5:** Commit schema + migration + repo + tests: `feat(db): CalendarEvent.source distinguishes app-created events`

### Task 7: `PATCH /calendar/events/:id`

**Files:**
- Modify: `packages/server/src/schemas.ts`, `packages/server/src/calendar-routes.ts`
- Test: `packages/server/test/calendar.test.ts` (extend the existing calendar route test file; match its fake-repo/fake-google pattern)

**Interfaces — Consumes:** `source` from Task 6; existing `deps.google.client.updateEvent(accessToken, calendarId, googleEventId, {summary, startDateTime, endDateTime})`. **Produces (Task 8 depends on this):** `PATCH /calendar/events/:id` body `{ title?, startsAt?, endsAt? }` (ISO strings) → 200 with the updated event JSON; 404 for missing/foreign/`google`-source; 400 when merged `endsAt <= startsAt`.

- [ ] **Step 1:** Schema in `schemas.ts` (match the file's zod style, e.g. `createCalendarEventSchema`):

```ts
export const updateCalendarEventSchema = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
}).refine((b) => b.title !== undefined || b.startsAt !== undefined || b.endsAt !== undefined,
  { message: 'empty update' });
```

- [ ] **Step 2: Failing tests:** happy-path retime (times change, `afterMutation` called once); title-only; 404 for `source: 'google'`; 404 for another user's event; 400 when merged times invert (e.g. only `startsAt` moved past existing `endsAt`); Google `updateEvent` called with the event's `googleCalendarId`/`googleEventId` when the row has them; Google failure → still 200 and local row updated (best-effort, same as POST/DELETE).
- [ ] **Step 3: Implement** in `calendar-routes.ts`:

```ts
app.patch('/calendar/events/:id', guard, async (request, reply) => {
  const { id } = idParamSchema.parse(request.params);
  const body = updateCalendarEventSchema.parse(request.body);
  const event = await deps.repos.calendarEvents.findById(request.userId, id);
  if (!event || event.source !== 'app') {
    reply.code(404).send({ code: 'not_found', message: `Event ${id} not found` });
    return;
  }
  const startsAt = body.startsAt ? new Date(body.startsAt) : event.startsAt;
  const endsAt = body.endsAt ? new Date(body.endsAt) : event.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) {
    reply.code(400).send({ code: 'invalid_range', message: 'endsAt must be after startsAt' });
    return;
  }
  const title = body.title ?? event.title;
  const updated = await deps.repos.calendarEvents.update(request.userId, id, { title, startsAt, endsAt });
  if (event.googleEventId && event.googleCalendarId) {
    try {
      const accessToken = await deps.google.tokens.getAccessToken(request.userId, deps.now());
      await deps.google.client.updateEvent(accessToken, event.googleCalendarId, event.googleEventId, {
        summary: title, startDateTime: startsAt.toISOString(), endDateTime: endsAt.toISOString(),
      });
    } catch { /* best-effort — local row is authoritative */ }
  }
  afterMutation(request.userId);
  return updated;
});
```

Add `update(userId, id, data)` to the calendar-event repository if absent (Task 6 owner may have added it — check first).

- [ ] **Step 4:** `npm test -w @notreclaim/server` green; `npm run build -w @notreclaim/server`.
- [ ] **Step 5:** Commit: `feat(server): PATCH /calendar/events/:id with Google write-back and replan`

### Task 8: Draggable app-created event blocks

**Files:**
- Modify: `packages/web/src/api/types.ts` (`CalendarEvent` + `source: 'app' | 'google'`), `packages/web/src/api/queries.ts` (add `useUpdateCalendarEvent`), `packages/web/src/app/planner/WeekGrid.tsx`, `packages/web/src/app/planner/EventBlock.tsx` (or a sibling `InteractiveEventBlock.tsx` if reuse is cleaner — decide by reading how `InteractiveBlock` receives its move/resize/commit callbacks and REUSE that machinery; do not fork the drag math)
- Test: `packages/web/src/app/planner/EventBlock.test.tsx`, `packages/web/src/api/queries.test.tsx`

**Interfaces — Consumes:** Task 7's PATCH. **Produces (Task 9 depends on this):** events with `source === 'app'` render as interactive blocks exposing an `onEdit(event)` click callback threaded from `Planner`; `useUpdateCalendarEvent()` mutation `{ id, title?, startsAt?, endsAt? }` with optimistic cache update + invalidation (copy the shape of the existing block-move mutation in `queries.ts`).

- [ ] **Step 1: Failing tests:** `useUpdateCalendarEvent` PATCHes and optimistically updates the events cache (mirror the existing optimistic-mutation test); an `app`-source event renders draggable (same hooks/attributes the task `InteractiveBlock` tests assert — reuse their synthetic pointer/drag helpers; NOTE from repo history: synthetic DnD needs spaced events, and `dragstart` must `setData`); a `google`-source event stays static (no drag handlers).
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.** Thread `zone`, geometry, and commit callback exactly like task blocks: drag/move/resize with the existing 15-min snap; on release commit `useUpdateCalendarEvent` with the new ISO times (optimistic). Click (no drag) on an `app` event calls `onEdit(event)`. `google` events keep today's static rendering.
- [ ] **Step 4:** `npm test -w @notreclaim/web` green; `npm run build -w @notreclaim/web`.
- [ ] **Step 5:** Commit: `feat(web): drag-reschedule app-created calendar events in the planner`

### Task 9: Event edit drawer

**Files:**
- Create: `packages/web/src/app/planner/EventDrawer.tsx`
- Modify: `packages/web/src/app/pages/Planner.tsx` (drawer state + `onEdit` wiring)
- Test: `packages/web/src/app/planner/EventDrawer.test.tsx`

**Interfaces — Consumes:** Task 8's `onEdit(event)` and `useUpdateCalendarEvent`; existing `useDeleteCalendarEvent` mutation (exists — delete route already shipped); existing drawer conventions: design-system styling, `useClickOutside` to close (copy structure from the task edit drawer component).

- [ ] **Step 1: Failing tests:** renders title/date/start/end pre-filled from the event (in the settings timezone, matching how the task drawer formats datetimes); Save calls `useUpdateCalendarEvent` with changed fields and closes; Delete calls the delete mutation and closes; outside click closes; invalid range (end ≤ start) disables Save.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement** following the task drawer's field grouping/markup; Tailwind literals; no new dependencies.
- [ ] **Step 4:** `npm test -w @notreclaim/web` green; `npm run build -w @notreclaim/web`.
- [ ] **Step 5:** Commit: `feat(web): edit drawer for app-created calendar events`

### Task 10: Full verification + live check

- [ ] **Step 1:** Root `npm run build` and root `npm test` (all workspaces, db suite needs local pg up) — everything green.
- [ ] **Step 2:** Live smoke test (see CLAUDE.md "Running the app locally"): rebuild, restart API with `.env.run`, restart Vite, seed via `seed-dev.mjs` AUTHURL. Verify in the browser: (a) with a 15-min buffer set, drag-pin a block and trigger a replan (edit a task) — auto blocks keep 15 min from the pinned one; (b) a habit with perPeriod 3 lands on 3 distinct days; (c) unrelated task edits do not move habit blocks; (d) create an event via click-to-create, drag it, edit it in the drawer, delete it.
- [ ] **Step 3:** Update the plan checkboxes, commit any test-only fixups: `test(review-17): full-suite pass`

## Self-review notes
- Spec A→Task 1+2, B→Task 4+5, C→Task 6+7+8+9, D→Task 3 (+ sticky interaction covered in Task 4 step 1 test 3). Coverage complete.
- Type consistency: `existingSlots` (Tasks 4/5), `source: 'app' | 'google'` (Tasks 6/7/8), `updateCalendarEventSchema` (Task 7), `useUpdateCalendarEvent` (Tasks 8/9) — names match across tasks.
- Engine `engineKey` churn for kept habit slots: kept slots are emitted first in start order, matching prior index order in the common case; residual index churn only re-keys (same times), acceptable.
