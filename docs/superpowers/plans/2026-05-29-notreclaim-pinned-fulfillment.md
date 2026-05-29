# NotReclaim Pinned-Block Fulfillment Implementation Plan (Milestone 3b-iii)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pinned blocks count toward their task's/habit's scheduled work (so the engine doesn't re-place covered time) and clear a pinned block's `engineKey` (so it can't collide on the unique diff key).

**Architecture:** Three small, additive changes — an optional `periodTargets` on the engine `Habit` (per-period occurrence counts), task-duration + habit-period reduction in `@notreclaim/core`'s `assembleScheduleInput`, and clearing `engineKey` when `@notreclaim/google`'s `detectDrift` pins a block — plus an end-to-end reconcile regression test for the previously-crashing flow.

**Tech Stack:** TypeScript (ESM, strict, `.js` import extensions), Vitest, npm workspaces. No DB migration; no Google credentials. Lands on `feat/writeback-reconcile`.

---

## Conventions

- All tests are deterministic and DB-free (injected fakes, fixed `now` epoch ms).
- The engine change is **additive/backward-compatible**: with `periodTargets` absent, behavior is identical, so all existing milestone-1/3a/3b-i/3b-ii tests stay green.
- Only **pinned** blocks reduce work; non-pinned engine blocks are the engine's own recomputed output.
- Build order: scheduler (Task 1) → core (Task 2) → google (Task 3), since each depends on the prior's rebuilt types.

## File Structure

```
packages/scheduler/src/types.ts          # MODIFY: Habit.periodTargets?
packages/scheduler/src/items.ts          # MODIFY: scheduleHabit per-period target
packages/scheduler/test/items.test.ts    # MODIFY: periodTargets tests
packages/core/src/assemble.ts            # MODIFY: task-duration + habit-period reduction
packages/core/test/assemble.test.ts      # MODIFY: reduction tests
packages/core/test/fakes.ts              # MODIFY (if needed): makeBlock engineKey
packages/google/src/detect-drift.ts      # MODIFY: clear engineKey on pin
packages/google/test/detect-drift.test.ts # MODIFY: assert engineKey null on pin
packages/google/test/reconcile.test.ts   # MODIFY: end-to-end regression test
```

---

### Task 1: Engine — per-period `periodTargets` (`@notreclaim/scheduler`)

**Files:**
- Modify: `packages/scheduler/src/types.ts`
- Modify: `packages/scheduler/src/items.ts`
- Modify: `packages/scheduler/test/items.test.ts`

- [ ] **Step 1: Add the failing tests.** Append to `packages/scheduler/test/items.test.ts` (the file has a `habit(over)` factory defaulting `id:'h1', title:'Exercise', chunkMs:30, perPeriod:2, periods:[{start:0,end:1000}]`):
```ts
describe('scheduleHabit with periodTargets (per-period counts)', () => {
  it('uses periodTargets[i] as each period\'s occurrence count', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 3,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [1, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(1);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('places nothing in a period whose target is 0', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [0, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(0);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('falls back to perPeriod when periodTargets is absent (unchanged behavior)', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2, periods: [{ start: 0, end: 1000 }] }));
    expect(result.blocks).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: FAIL — `periodTargets` not a known property / counts wrong.

- [ ] **Step 3: Add the field to `packages/scheduler/src/types.ts`.** In the `Habit` interface, after `allowedWindows?: Interval[];`, add:
```ts
  /**
   * Optional per-period occurrence targets, parallel to `periods`. When present,
   * periodTargets[i] is the number of occurrences to place in periods[i]
   * (0 places none). When absent, every period uses `perPeriod` (previous behavior).
   */
  periodTargets?: number[];
```

- [ ] **Step 4: Update `scheduleHabit` in `packages/scheduler/src/items.ts`** to iterate periods by index and honor the per-period target. Replace the entire `scheduleHabit` function with:
```ts
export function scheduleHabit(free: Interval[], habit: Habit): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
  let missed = 0;
  let index = 0;

  for (let i = 0; i < habit.periods.length; i++) {
    const period = habit.periods[i]!;
    const target = habit.periodTargets?.[i] ?? habit.perPeriod;
    const periodWindow: Interval[] = [period];
    const bound = habit.allowedWindows
      ? intersectIntervals(habit.allowedWindows, periodWindow)
      : periodWindow;
    const preferred = habit.preferredWindows
      ? intersectIntervals(habit.preferredWindows, bound)
      : undefined;

    for (let k = 0; k < target; k++) {
      const primaryWindow = preferred && preferred.length > 0 ? preferred : bound;
      let res = placeItem(remainingFree, [habit.chunkMs], period.end, primaryWindow);
      if (res.placements.length === 0 && primaryWindow !== bound) {
        res = placeItem(remainingFree, [habit.chunkMs], period.end, bound);
      }

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      remainingFree = res.free;
      const p = res.placements[0]!;
      blocks.push({
        id: `habit:${habit.id}:${index}`,
        sourceType: 'habit',
        sourceId: habit.id,
        title: habit.title,
        start: p.start,
        end: p.end,
      });
      index++;
    }
  }

  const unscheduled: UnscheduledItem[] =
    missed > 0
      ? [
          {
            sourceType: 'habit',
            sourceId: habit.id,
            title: habit.title,
            reason: 'could not place all habit occurrences in free time',
            remainingMs: missed * habit.chunkMs,
          },
        ]
      : [];

  return { blocks, free: remainingFree, unscheduled };
}
```
(The only changes vs. the previous version: indexed `for` loop, the `target` line, and `k < target` instead of `k < habit.perPeriod`. When `periodTargets` is absent, `target === perPeriod`, identical to before.)

- [ ] **Step 5: Run the full scheduler suite.**
Run: `cd packages/scheduler && npx vitest run`
Expected: PASS — existing tests + 3 new (31 total).

- [ ] **Step 6: Rebuild the scheduler so downstream packages see the new field.**
Run: `cd packages/scheduler && npm run build`
Expected: clean; `dist/index.d.ts` includes `periodTargets`.

- [ ] **Step 7: Commit.**
```bash
git add packages/scheduler/src/types.ts packages/scheduler/src/items.ts packages/scheduler/test/items.test.ts
git commit -m "feat(scheduler): add per-period periodTargets to habit scheduling"
```

---

### Task 2: Core — task-duration + habit-period reduction (`@notreclaim/core`)

**Files:**
- Modify: `packages/core/src/assemble.ts`
- Modify: `packages/core/test/assemble.test.ts`
- Modify (if needed): `packages/core/test/fakes.ts`

- [ ] **Step 1: Ensure the core test fakes can express pinned blocks.** Read `packages/core/test/fakes.ts`. Confirm it exports `makeBlock` and that `fakeRepos` accepts a `blocks` field returned by `scheduledBlocks.listByUserInRange`. If `makeBlock`'s returned object is missing an `engineKey` field (added to `ScheduledBlock` in 3b-ii), add `engineKey: null,` to it so it matches the current type. (No other change needed; `makeBlock` should already accept `taskId`/`habitId`/`pinned`/`startsAt`/`endsAt` overrides.)

- [ ] **Step 2: Write the failing tests.** Append to `packages/core/test/assemble.test.ts` inside the `describe('assembleScheduleInput', ...)` block (the file imports `fakeRepos, makeSettings, makeTask, makeHabit` and a `utc()` helper; add `makeBlock` to that import from `./fakes.js`):
```ts
  it('reduces a task duration by pinned-block coverage', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 3600000, minChunkMs: 1800000, maxChunkMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1800000); // 1h - 30m
  });

  it('drops a task fully covered by pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('does not reduce a task for non-pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1800000);
  });

  it('reduces a habit period target by pinned occurrences in that period', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday, ISO week start
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [makeBlock({
          id: 'b1', taskId: null, habitId: 'h1', pinned: true,
          startsAt: new Date(utc('2026-01-06T09:00:00')), endsAt: new Date(utc('2026-01-06T09:30:00')),
        })],
      }),
      'u1', now,
    );
    const h1 = input.habits.find((h) => h.id === 'h1')!;
    expect(h1.periodTargets).toBeDefined();
    expect(h1.periodTargets![0]).toBe(2); // perPeriod 3 - 1 pinned occurrence
  });

  it('leaves habit periodTargets undefined when there is no pinned coverage', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
      }),
      'u1', now,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toBeUndefined();
  });
```

- [ ] **Step 3: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/assemble.test.ts`
Expected: FAIL — durations not reduced / `periodTargets` undefined.

- [ ] **Step 4: Update `packages/core/src/assemble.ts`.** Replace the task-building block and the habit-building block (the two segments that currently read `const tasks = allTasks.filter(...).map(toFlexibleTask)` and `const habits = allHabits.filter(...).map(...)`) with:
```ts
  // Pinned-block coverage reduces the work the engine must (re)place.
  const taskCoverageMs = new Map<string, number>();
  for (const b of pinnedBlocks) {
    if (b.sourceType === 'task') {
      taskCoverageMs.set(b.sourceId, (taskCoverageMs.get(b.sourceId) ?? 0) + (b.end - b.start));
    }
  }

  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = [];
  for (const t of allTasks) {
    if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
    const flexible = toFlexibleTask(t);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0);
    if (remaining <= 0) continue; // fully covered by pinned blocks -> nothing to place
    tasks.push({ ...flexible, durationMs: remaining });
  }

  const allHabits = await repos.habits.listByUser(userId);
  const habits: EngineHabit[] = [];
  for (const h of allHabits) {
    if (h.status !== 'active') continue;
    const engineHabit = expandHabit(h, settings.timezone, now, horizonDays);
    const occurrences = engineHabit.periods.map(
      (p) =>
        pinnedBlocks.filter(
          (b) => b.sourceType === 'habit' && b.sourceId === h.id && b.start >= p.start && b.start < p.end,
        ).length,
    );
    if (occurrences.some((count) => count > 0)) {
      engineHabit.periodTargets = engineHabit.periods.map((_p, i) => Math.max(0, h.perPeriod - occurrences[i]!));
    }
    habits.push(engineHabit);
  }
```
(`pinnedBlocks`, `SCHEDULABLE_TASK_STATUSES`, `toFlexibleTask`, `expandHabit`, and the `FlexibleTask`/`EngineHabit` types are all already in scope from the existing file.)

- [ ] **Step 5: Run the core suite.**
Run: `cd packages/core && npx vitest run`
Expected: PASS — existing 22 + 5 new (27 total).

- [ ] **Step 6: Rebuild core.**
Run: `cd packages/core && npm run build`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add packages/core/src/assemble.ts packages/core/test/assemble.test.ts packages/core/test/fakes.ts
git commit -m "feat(core): reduce task duration and habit targets by pinned coverage"
```

---

### Task 3: Google — clear `engineKey` on pin + end-to-end regression

**Files:**
- Modify: `packages/google/src/detect-drift.ts`
- Modify: `packages/google/test/detect-drift.test.ts`
- Modify: `packages/google/test/reconcile.test.ts`

- [ ] **Step 1: Add the failing assertion for Part A.** In `packages/google/test/detect-drift.test.ts`, in the existing `it('pins a block when the user moved its Google event', ...)`, add after the existing `expect(b.startsAt...)` assertion:
```ts
    expect(b.engineKey).toBeNull();
```
(The seeded block has `engineKey: 'task:t:0'`; after pinning it must be cleared.)

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/detect-drift.test.ts`
Expected: FAIL — `engineKey` is still `'task:t:0'`, not null.

- [ ] **Step 3: Clear `engineKey` on pin in `packages/google/src/detect-drift.ts`.** In the move branch, change the `update` call to also clear `engineKey`:
```ts
      await deps.scheduledBlocks.update(userId, block.id, {
        startsAt: new Date(eventStart),
        endsAt: new Date(eventEnd),
        pinned: true,
        engineKey: null,
      });
```

- [ ] **Step 4: Run detect-drift tests.**
Run: `cd packages/google && npx vitest run test/detect-drift.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the end-to-end regression test.** Append to `packages/google/test/reconcile.test.ts` inside the `describe('reconcile', ...)` block (it imports `makeScheduledBlock`, `makeTask`, `buildDeps`, `googleEventsFromStore`, `FakeGoogleClient`, `fakeScheduledBlockStore`, `NOW`):
```ts
  it('does not duplicate or crash when a pinned block fully covers a still-pending task', async () => {
    // Drift would have pinned this block and cleared its engineKey. The task is
    // still pending; pinned coverage must make the engine NOT re-place it.
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: 'g1', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }]; // drift: pinned event present, unchanged
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client }); // 30-min task, fully covered

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, deleted: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(store.all().some((b) => b.id === 'b1')).toBe(true); // pinned block survives
  });
```

- [ ] **Step 6: Run to verify it passes** (it relies on Task 2's task reduction).
Run: `cd packages/google && npx vitest run test/reconcile.test.ts`
Expected: PASS (6 tests). The regression test must NOT throw `ConflictError` and must record zero inserts.

- [ ] **Step 7: Build google + run the whole monorepo.**
Run: `cd packages/google && npm run build && npm run typecheck:scripts`
Then: `cd /home/nyx-ai/Projects/NotReclaim && npm test`
Expected: build clean; all packages green — scheduler 31, db 34, core 27, google 32 (confirm actual counts; the gate is all-green).

- [ ] **Step 8: Commit.**
```bash
git add packages/google/src/detect-drift.ts packages/google/test/detect-drift.test.ts packages/google/test/reconcile.test.ts
git commit -m "fix(google): clear engineKey on pin; regression test for pinned-task reconcile"
```

---

## Self-Review Notes

- **Spec coverage:** Part A — clear `engineKey` on pin (Task 3) · Part B1 — task-duration reduction + drop-if-covered, pinned-only (Task 2) · Part B2 — additive `periodTargets` engine field (Task 1) + core per-period reduction set only when covered (Task 2) · end-to-end reconcile regression (Task 3). All deferred/non-goal items (time-tracking reduction, auto-complete, HTTP/timer) absent.
- **Type consistency:** `periodTargets?: number[]` defined on the engine `Habit` (Task 1) is read in `scheduleHabit` (Task 1) and written in `assembleScheduleInput` (Task 2). `engineKey: null` in the drift update (Task 3) matches `UpdateScheduledBlockInput` (3b-ii). Task/habit coverage uses the engine `pinnedBlocks` (`sourceType`/`sourceId`/`start`/`end`) already built in `assemble.ts`.
- **Backward compatibility:** `periodTargets` absent ⇒ `target === perPeriod`, so existing scheduler/3a tests are unchanged (Task 1 Step 5 verifies). Core reduction only triggers on pinned coverage, so existing core tests with no pinned blocks are unaffected.
- **No placeholders; determinism:** complete code throughout; `now` injected; no new randomness.
- **Build order:** Task 1 rebuilds scheduler; Task 2 rebuilds core; both precede the google work in Task 3 (whose regression test depends on Task 2's task reduction).
```
