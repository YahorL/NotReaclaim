# Optional Task Deadlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task have no due date; it is still auto-scheduled by priority, and never warns when it doesn't fit.

**Architecture:** `Task.dueBy` becomes nullable in Postgres. The scheduler package is untouched — `packages/db`'s `toFlexibleTask` maps a null due date to the planning horizon's end, which is observationally identical to "no deadline" because `placeItem` only tests `start + size <= deadline` and the free timeline is already clipped to the horizon. `packages/core` tracks which task ids were undated and strips their rows out of the engine's `unscheduled` output, which silences both the amber banner and the at-risk ⚠ (both read `preview.unscheduled`).

**Tech Stack:** TypeScript (ESM, strict), Prisma + PostgreSQL, Fastify + zod, React 18 + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-optional-task-deadlines-design.md`

## Global Constraints

- Backend packages (`db`, `core`, `scheduler`, `google`, `server`) use explicit `.js` extensions on relative imports. `packages/web` imports are extensionless and never `import React`.
- Packages consume each other's built `dist/`, so after changing `packages/db` you MUST run `npm run build -w @notreclaim/db` before `packages/core` typechecks or tests against it. Same for `core` → `server`.
- Web tests run with `TZ=UTC` (the package `test` script sets it — do not bypass it).
- **`@notreclaim/db` tests cannot run in this worktree**: `packages/db/vitest.config.ts` applies `globalSetup: ['./test/global-setup.ts']` to every file in the package, which throws without `TEST_DATABASE_URL`, and there is no `packages/db/.env.test`. Tests written there are still written, but their red/green cycle is carried by `packages/core` tests, which use fakes and run normally. Never report a db-package test as passing without having run it.
- Do NOT run any branch-switching git command (`git checkout <branch>`, `git switch`, `git worktree` …). Work only on the current branch.
- Never modify `packages/scheduler` in this plan. If a task seems to require it, stop and report.
- The working tree already contains an unrelated uncommitted change to `packages/core/src/assemble.ts` (habit period proration) and its tests. Leave it alone; stage only the files each task names.

---

### Task 1: Make `dueBy` nullable in the database and map null to a fallback

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `Task` model's `dueBy` line)
- Create: `packages/db/prisma/migrations/20260822000000_task_due_by_optional/migration.sql`
- Modify: `packages/db/src/mappers.ts:17-28`
- Modify: `packages/db/src/repositories/task-repository.ts:17-41` (`CreateTaskInput`, `UpdateTaskInput`)
- Test: `packages/db/test/mappers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `toFlexibleTask(row: Task, fallbackDueBy: number): FlexibleTask` — the second parameter is REQUIRED, so every call site states its own horizon. `CreateTaskInput.dueBy?: Date | null` and `UpdateTaskInput.dueBy?: Date | null`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/test/mappers.test.ts`, inside the existing `describe('toFlexibleTask', ...)` block. Copy the `row` literal from the test already in that block and change `dueBy` — the object must still satisfy `Task`, so keep every other field.

```ts
  it('falls back to the supplied dueBy when the task has no due date', () => {
    const row = {
      id: 't1',
      userId: 'u1',
      title: 'Write report',
      priority: 2,
      sortOrder: 0,
      durationMs: 3_600_000,
      dueBy: null,
      notBefore: null,
      minChunkMs: 900_000,
      maxChunkMs: 1_800_000,
      categoryId: null,
      status: 'pending',
      completedAt: null,
      timeLoggedMs: 0,
      createdAt: D('2026-01-01T00:00:00.000Z'),
      updatedAt: D('2026-01-01T00:00:00.000Z'),
    } satisfies Task;
    const horizonEnd = D('2026-01-15T00:00:00.000Z').getTime();
    expect(toFlexibleTask(row, horizonEnd).dueBy).toBe(horizonEnd);
  });
```

Also update the existing `toFlexibleTask` test in that block to pass a second argument (any number, e.g. `0`) and assert the row's own date still wins.

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `npm run build -w @notreclaim/db`
Expected: FAIL — `dueBy: null` is not assignable to `Date`, and `toFlexibleTask` takes 1 argument.

(Do not try `npm test -w @notreclaim/db`; see Global Constraints. The behavioral red/green for this mapper is Task 2, Step 2.)

- [ ] **Step 3: Make the column nullable**

In `packages/db/prisma/schema.prisma`, change the `Task` model's line:

```prisma
  dueBy        DateTime?  @db.Timestamptz
```

Create `packages/db/prisma/migrations/20260822000000_task_due_by_optional/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "dueBy" DROP NOT NULL;
```

The migration is hand-written on purpose: `prisma migrate dev` needs a reachable database, and this worktree may not have one. Existing rows keep their values — the statement only drops the constraint.

Then regenerate the client (this works offline, it only reads the schema):

```bash
npm run prisma:generate -w @notreclaim/db
```

- [ ] **Step 4: Update the mapper and the repository input types**

`packages/db/src/mappers.ts` — replace the `toFlexibleTask` function:

```ts
/**
 * Map a task row to the engine's FlexibleTask (epoch-ms dueBy).
 *
 * A task with no due date is mapped to `fallbackDueBy` (core passes the horizon end).
 * That is exact, not a fudge: `placeItem` uses the deadline only as
 * `start + size <= deadline`, and the free timeline is already clipped to the horizon,
 * so "no deadline" and "due at the horizon edge" are indistinguishable to the engine.
 */
export function toFlexibleTask(row: Task, fallbackDueBy: number): FlexibleTask {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    sortOrder: row.sortOrder,
    durationMs: row.durationMs,
    dueBy: row.dueBy?.getTime() ?? fallbackDueBy,
    minChunkMs: row.minChunkMs,
    maxChunkMs: row.maxChunkMs,
  };
}
```

`packages/db/src/repositories/task-repository.ts` — in `CreateTaskInput` change `dueBy: Date;` to `dueBy?: Date | null;`, and in `UpdateTaskInput` change `dueBy?: Date;` to `dueBy?: Date | null;`.

- [ ] **Step 5: Verify the package builds**

Run: `npm run build -w @notreclaim/db`
Expected: PASS (no type errors). `packages/core` will not compile yet — that is Task 2.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260822000000_task_due_by_optional packages/db/src/mappers.ts packages/db/src/repositories/task-repository.ts packages/db/test/mappers.test.ts
git commit -m "feat(db): allow tasks without a due date"
```

---

### Task 2: Schedule undated tasks and keep them out of the warning

**Files:**
- Modify: `packages/core/src/assemble.ts:40-44` (signature), `:120-137` (task loop), and its return object
- Modify: `packages/core/src/compute.ts`
- Test: `packages/core/test/assemble.test.ts`, `packages/core/test/compute.test.ts`, `packages/core/test/fakes.ts`

**Interfaces:**
- Consumes: `toFlexibleTask(row, fallbackDueBy)` from Task 1.
- Produces: `AssembledScheduleInput = ScheduleInput & { undatedTaskIds: string[] }`, the new return type of `assembleScheduleInput`. `computeDesiredSchedule`'s signature and `ScheduleResult` return type are unchanged.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/fakes.ts` — `makeTask(over: Partial<Task> = {})` already accepts `dueBy: null` once Task 1's schema change lands, so no edit is needed there. Leave its `dueBy` default alone: existing tests rely on it.

Add to `packages/core/test/assemble.test.ts`, inside the top-level `describe('assembleScheduleInput', ...)`:

```ts
  it('gives an undated task the horizon end as its engine deadline and lists it as undated', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        tasks: [
          makeTask({ id: 't1', dueBy: null }),
          makeTask({ id: 't2', dueBy: new Date(utc('2026-01-06T10:00:00')) }),
        ],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.dueBy).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(input.undatedTaskIds).toEqual(['t1']);
  });

  it('reports no undated ids when every task has a due date', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({ settings: makeSettings({ horizonDays: 7 }), tasks: [makeTask({ id: 't1' })] }),
      'u1', now,
    );
    expect(input.undatedTaskIds).toEqual([]);
  });
```

Add to `packages/core/test/compute.test.ts`, inside `describe('computeDesiredSchedule', ...)`:

```ts
  it('schedules an undated task like any other when there is room', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const wh = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 7,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({ id: 't1', dueBy: null, durationMs: 3_600_000, minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })],
      }),
      'u1', now,
    );
    expect(result.blocks.filter((b) => b.sourceId === 't1')).toHaveLength(1);
    expect(result.unscheduled).toEqual([]);
  });

  it('never reports an undated task as unscheduled, even with no free time', async () => {
    const now = utc('2026-01-05T00:00:00');
    const wh = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 1,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({ id: 't1', dueBy: null, durationMs: 3_600_000, minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })],
        events: [makeEvent({
          id: 'busy',
          startsAt: new Date(utc('2026-01-05T00:00:00')),
          endsAt: new Date(utc('2026-01-06T00:00:00')),
        })],
      }),
      'u1', now,
    );
    expect(result.blocks.filter((b) => b.sourceId === 't1')).toHaveLength(0);
    expect(result.unscheduled).toEqual([]);
  });

  it('still reports a DATED task that does not fit', async () => {
    const now = utc('2026-01-05T00:00:00');
    const wh = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc', horizonDays: 1,
          workingHours: wh as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({
          id: 't1', dueBy: new Date(utc('2026-01-05T18:00:00')),
          durationMs: 3_600_000, minChunkMs: 3_600_000, maxChunkMs: 3_600_000,
        })],
        events: [makeEvent({
          id: 'busy',
          startsAt: new Date(utc('2026-01-05T00:00:00')),
          endsAt: new Date(utc('2026-01-06T00:00:00')),
        })],
      }),
      'u1', now,
    );
    expect(result.unscheduled.some((u) => u.sourceId === 't1')).toBe(true);
  });
```

`compute.test.ts` imports `makeEvent` already if a prior task added it; if its import line lacks `makeEvent`, add it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build -w @notreclaim/db && npm test -w @notreclaim/core`
Expected: FAIL — `toFlexibleTask` is called with 1 argument, `undatedTaskIds` does not exist, and the undated task reports as unscheduled.

- [ ] **Step 3: Implement in `assemble.ts`**

Add above `assembleScheduleInput`:

```ts
/**
 * The engine input plus the ids of tasks that have NO due date. The engine is
 * deliberately unaware of undated tasks (they reach it with `dueBy` = horizon end);
 * core carries the distinction so `computeDesiredSchedule` can keep them out of the
 * unscheduled warning. `schedule()` ignores the extra field.
 */
export type AssembledScheduleInput = ScheduleInput & { undatedTaskIds: string[] };
```

Change the return type on line 44 from `Promise<ScheduleInput>` to `Promise<AssembledScheduleInput>`.

In the task loop, replace `const flexible = toFlexibleTask(t);` with:

```ts
    const flexible = toFlexibleTask(t, horizonEnd.getTime());
    if (t.dueBy == null) undatedTaskIds.push(t.id);
```

and declare the accumulator next to `const tasks: FlexibleTask[] = [];`:

```ts
  const undatedTaskIds: string[] = [];
```

Push it onto the returned object, after `blockBufferMs`:

```ts
    undatedTaskIds,
```

Note the accumulator is filled inside the loop AFTER the `continue` guards, so a task that is filtered out (not schedulable, already started, fully covered) is correctly absent — it can never appear in `unscheduled` either.

- [ ] **Step 4: Implement the filter in `compute.ts`**

```ts
import { schedule } from '@notreclaim/scheduler';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { assembleScheduleInput, type SchedulingRepositories } from './assemble.js';

/** Assemble inputs from the DB and run the engine to get the desired schedule. */
export async function computeDesiredSchedule(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
): Promise<ScheduleResult> {
  const input = await assembleScheduleInput(repos, userId, now);
  const result = schedule(input);
  if (input.undatedTaskIds.length === 0) return result;
  // A task with no due date is never "late": there is no date it missed. It simply waits
  // for room, so it must not raise the amber banner or the at-risk ⚠ (both read this list).
  const undated = new Set(input.undatedTaskIds);
  return {
    ...result,
    unscheduled: result.unscheduled.filter(
      (u) => !(u.sourceType === 'task' && undated.has(u.sourceId)),
    ),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/core`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/compute.ts packages/core/test/assemble.test.ts packages/core/test/compute.test.ts packages/core/test/fakes.ts
git commit -m "feat(core): schedule undated tasks without warning about them"
```

`packages/core/src/assemble.ts` is intentionally NOT in that `git add` list — it carries an unrelated uncommitted change. Stage it with an explicit interactive-free hunk selection, or commit it together and say so in the report. Do not silently bundle unrelated work.

---

### Task 3: Accept and clear a null `dueBy` over the API

**Files:**
- Modify: `packages/server/src/schemas.ts:8-22`
- Modify: `packages/server/src/task-routes.ts:17-26` (POST), `:47-62` (PATCH)
- Test: `packages/server/test/tasks.test.ts`

**Interfaces:**
- Consumes: `CreateTaskInput.dueBy?: Date | null` from Task 1.
- Produces: `POST /tasks` accepts `dueBy` absent, `null`, or an ISO string. `PATCH /tasks/:id` treats an absent `dueBy` as "unchanged" and an explicit `null` as "clear".

- [ ] **Step 1: Write the failing tests**

Follow the file's existing setup helpers (app builder, auth header) rather than inventing new ones — read the top of the test file first and mirror the surrounding tests.

```ts
  it('creates a task with no due date when dueBy is omitted', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tasks', headers: authHeader,
      payload: { title: 'Someday', priority: 3, durationMs: 3_600_000, minChunkMs: 900_000, maxChunkMs: 1_800_000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dueBy).toBeNull();
  });

  it('creates a task with no due date when dueBy is explicitly null', async () => {
    const res = await app.inject({
      method: 'POST', url: '/tasks', headers: authHeader,
      payload: { title: 'Someday', priority: 3, durationMs: 3_600_000, minChunkMs: 900_000, maxChunkMs: 1_800_000, dueBy: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dueBy).toBeNull();
  });

  it('clears an existing due date when PATCHed with null', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${existingTaskId}`, headers: authHeader,
      payload: { dueBy: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dueBy).toBeNull();
  });

  it('leaves the due date untouched when PATCH omits dueBy', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${existingTaskId}`, headers: authHeader,
      payload: { title: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dueBy).not.toBeNull();
  });
```

`existingTaskId` must be a task the test's fake repo already holds with a non-null `dueBy`; reuse whatever fixture the neighbouring PATCH tests use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/server -- test/tasks.test.ts`
Expected: FAIL — zod rejects the missing/null `dueBy` on POST (400), and the PATCH-null case leaves the date unchanged.

- [ ] **Step 3: Implement**

`packages/server/src/schemas.ts` — in `createTaskSchema`:

```ts
  dueBy: z.string().datetime().nullable().optional(),
```

`updateTaskSchema` derives from `createTaskSchema.partial()`, so it inherits this with no separate edit.

`packages/server/src/task-routes.ts` — POST body mapping:

```ts
      dueBy: body.dueBy ? new Date(body.dueBy) : null,
```

PATCH `data` — replace the `dueBy` line, mirroring how `notBefore` on the next line already distinguishes absent from null:

```ts
      ...(dueByStr !== undefined ? { dueBy: dueByStr === null ? null : new Date(dueByStr) } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build -w @notreclaim/db && npm run build -w @notreclaim/core && npm test -w @notreclaim/server`
Expected: PASS, whole server suite (149 tests before this task, plus the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/schemas.ts packages/server/src/task-routes.ts packages/server/test/tasks.test.ts
git commit -m "feat(server): accept and clear an optional task due date"
```

---

### Task 4: Let the web forms produce and round-trip a null due date

**Files:**
- Modify: `packages/web/src/api/types.ts:28` (`Task.dueBy`), `:167` (`CreateTaskInput.dueBy`)
- Modify: `packages/web/src/app/tasks/taskForm.ts:33-45` (`toFormState`), `:47-56` (`validateTaskForm`), `:58-68` (`toUpdateInput`)
- Modify: `packages/web/src/app/shell/newTaskForm.ts:42-51` (`validateNewTaskForm`), `:53-68` (`toCreateTaskInput`); leave `defaultNewTaskForm:24-38` untouched
- Test: `packages/web/src/app/tasks/taskForm.test.ts`, `packages/web/src/app/shell/newTaskForm.test.ts`

**Interfaces:**
- Consumes: the API contract from Task 3.
- Produces: `Task.dueBy: string | null` and `CreateTaskInput.dueBy?: string | null` in `packages/web/src/api/types.ts`; both form modules emit `dueBy: null` for an empty field. `TaskFormState.dueByLocal` stays `string` (`''` means undated).

- [ ] **Step 1: Write the failing tests**

`packages/web/src/app/tasks/taskForm.test.ts`:

```ts
  it('accepts an empty due date', () => {
    const s = { ...validState, dueByLocal: '' };
    expect(validateTaskForm(s).ok).toBe(true);
    expect(validateTaskForm(s).errors.dueByLocal).toBeUndefined();
  });

  it('emits a null dueBy for an empty due date', () => {
    expect(toUpdateInput({ ...validState, dueByLocal: '' }).dueBy).toBeNull();
  });

  it('still rejects an unparseable due date', () => {
    expect(validateTaskForm({ ...validState, dueByLocal: 'not-a-date' }).ok).toBe(false);
  });

  it('maps a null dueBy back to an empty field', () => {
    expect(toFormState({ ...someTask, dueBy: null }).dueByLocal).toBe('');
  });
```

`validState` / `someTask`: reuse the fixtures already defined at the top of that test file; do not invent parallel ones.

`packages/web/src/app/shell/newTaskForm.test.ts`:

```ts
  it('accepts an empty due date', () => {
    expect(validateNewTaskForm({ ...validState, dueByLocal: '' }).ok).toBe(true);
  });

  it('emits a null dueBy for an empty due date', () => {
    expect(toCreateTaskInput({ ...validState, dueByLocal: '' }).dueBy).toBeNull();
  });

  it('still defaults a new task to seven days out', () => {
    const s = defaultNewTaskForm(Date.parse('2026-01-05T12:00:00.000Z'));
    expect(s.dueByLocal).not.toBe('');
  });
```

`defaultNewTaskForm` is the initial-state factory (`packages/web/src/app/shell/newTaskForm.ts:24`); check its exact parameter list before calling it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts src/app/shell/newTaskForm.test.ts`
Expected: FAIL — empty due dates are rejected, and `toUpdateInput` returns an ISO string built from `''`.

- [ ] **Step 3: Implement**

`packages/web/src/api/types.ts` — `Task.dueBy: string | null;` and `CreateTaskInput.dueBy?: string | null;` (making it optional on create matches the server, where the field may be omitted entirely).

`packages/web/src/app/tasks/taskForm.ts`:

```ts
export function toFormState(t: Task): TaskFormState {
  return {
    title: t.title,
    durationMs: t.durationMs,
    dueByLocal: t.dueBy ? isoToLocalInput(t.dueBy) : '',
    notBeforeLocal: t.notBefore ? isoToLocalInput(t.notBefore) : '',
    minChunkMs: t.minChunkMs,
    maxChunkMs: t.maxChunkMs,
    categoryId: t.categoryId,
  };
}
```

In `validateTaskForm`, replace the `dueByLocal` rule with one that only rejects a non-empty unparseable value — an empty field now means "no deadline":

```ts
  if (s.dueByLocal && Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'Enter a valid due date or leave it empty';
```

In `toUpdateInput`:

```ts
    dueBy: s.dueByLocal ? localInputToIso(s.dueByLocal) : null,
```

`packages/web/src/app/shell/newTaskForm.ts` — the same two edits:

```ts
  if (s.dueByLocal && Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'Enter a valid due date or leave it empty';
```

```ts
    dueBy: s.dueByLocal ? localInputToIso(s.dueByLocal) : null,
```

Leave the `+7d` default in the initial-state factory untouched — undated is opt-in.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts src/app/shell/newTaskForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole web suite for type/regression fallout**

Run: `npm test -w @notreclaim/web`
Expected: PASS. `Task.dueBy` is now nullable, so any fixture or component that assumed a string may surface here; components are Task 5's job, but if a test fails only because a fixture needs `dueBy: null` handling, note it and leave it for Task 5 rather than patching components in this task.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/app/tasks/taskForm.ts packages/web/src/app/shell/newTaskForm.ts packages/web/src/app/tasks/taskForm.test.ts packages/web/src/app/shell/newTaskForm.test.ts
git commit -m "feat(web): allow an empty due date in the task forms"
```

---

### Task 5: Show and sort undated tasks in the UI

**Files:**
- Modify: `packages/web/src/app/priorities/TaskRow.tsx:6-8` (`dueShort`), `:39` (`meta`)
- Modify: `packages/web/src/app/priorities/priorityBucket.ts:64-66` (`sortBucket`)
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx:110` (flat sort)
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx:84-90` (Due by field), `packages/web/src/app/shell/NewTaskModal.tsx:108-111` (Due date field)
- Test: `packages/web/src/app/priorities/priorityBucket.test.ts`, `packages/web/src/app/priorities/TaskRow.test.tsx`

**Interfaces:**
- Consumes: `Task.dueBy: string | null` from Task 4.
- Produces: no new exported symbols. `sortBucket`'s type parameter widens to `T extends { sortOrder: number; dueBy: string | null }`.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/app/priorities/priorityBucket.test.ts`, inside `describe('sortBucket', ...)`:

```ts
  it('sorts undated tasks after dated ones at the same sortOrder', () => {
    const tasks = [
      { id: 'undated', sortOrder: 1, dueBy: null },
      { id: 'dated', sortOrder: 1, dueBy: '2026-01-09T10:00:00.000Z' },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('keeps sortOrder ahead of datedness', () => {
    const tasks = [
      { id: 'dated', sortOrder: 2, dueBy: '2026-01-09T10:00:00.000Z' },
      { id: 'undated', sortOrder: 1, dueBy: null },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['undated', 'dated']);
  });
```

`packages/web/src/app/priorities/TaskRow.test.tsx` — mirror the render helper the neighbouring tests use:

```ts
  it('renders "No deadline" for a task without a due date', () => {
    renderRow({ ...baseTask, dueBy: null });
    expect(screen.getByText(/No deadline/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/web -- src/app/priorities/priorityBucket.test.ts src/app/priorities/TaskRow.test.tsx`
Expected: FAIL — `Date.parse(null)` yields `NaN` so the comparator returns `NaN` and the order is not the asserted one; `TaskRow` renders `Due Invalid Date`.

- [ ] **Step 3: Implement the sorts**

`packages/web/src/app/priorities/priorityBucket.ts`:

```ts
// An undated task sorts last within its sortOrder: `Date.parse(null)` is NaN, and a NaN
// comparator result leaves the order implementation-defined.
export function sortBucket<T extends { sortOrder: number; dueBy: string | null }>(tasks: T[]): T[] {
  const due = (t: T) => (t.dueBy ? Date.parse(t.dueBy) : Infinity);
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || due(a) - due(b));
}
```

`packages/web/src/app/planner/PlannerTaskPanel.tsx` — the flat sort's second term has the same NaN hazard (`Date.parse(a.dueBy ?? '')`). Replace line 110 with:

```ts
      const ad = a.dueBy ? Date.parse(a.dueBy) : Infinity;
      const bd = b.dueBy ? Date.parse(b.dueBy) : Infinity;
      return ad - bd;
```

`dueLabel` in that file already returns `null` for a falsy `dueBy`, so the card needs no change.

- [ ] **Step 4: Implement the label**

`packages/web/src/app/priorities/TaskRow.tsx`:

```ts
function dueShort(iso: string | null): string {
  if (!iso) return 'No deadline';
  return `Due ${new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(iso))}`;
}
```

and line 39 loses its now-duplicated `Due ` prefix:

```ts
  const meta = `${dueShort(task.dueBy)}${nextMs !== null ? ` · Next: ${relativeDayTimeLabel(nextMs, now)}` : ''}`;
```

- [ ] **Step 5: Add the discoverability hint**

`packages/web/src/app/tasks/TaskDrawer.tsx`, under the "Due by" `FieldBox`, before the error paragraph:

```tsx
            <p className="mt-1 text-[11px] text-ink/50">Leave empty for no deadline</p>
```

`packages/web/src/app/shell/NewTaskModal.tsx`, inside the "Due date" `FieldBox` after the input:

```tsx
            <p className="mt-1 text-[11px] text-ink/50">Leave empty for no deadline</p>
```

Check `text-ink/50` against the surrounding file: if neighbouring muted text uses a different token, use that one instead — Tailwind v3 needs literal class strings, so do not compute them.

- [ ] **Step 6: Run the full web suite**

Run: `npm test -w @notreclaim/web`
Expected: PASS (453 tests before this plan, plus the new ones).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/priorityBucket.ts packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/shell/NewTaskModal.tsx packages/web/src/app/priorities/priorityBucket.test.ts packages/web/src/app/priorities/TaskRow.test.tsx
git commit -m "feat(web): show and sort tasks with no deadline"
```

---

### Task 6: Whole-repo verification

**Files:** none modified.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Build every workspace**

Run: `npm run build`
Expected: PASS, all packages including the web vite build.

- [ ] **Step 2: Run every suite**

Run: `npm test`
Expected: PASS for `scheduler`, `core`, `google`, `server`, `web`. `@notreclaim/db` will FAIL with `TEST_DATABASE_URL is not set` — that is the pre-existing environment gap from Global Constraints, not a regression. Report it as unrun, never as passing.

- [ ] **Step 3: Report**

State the per-package test counts, name the db package as unrun with its reason, and list anything left undone. Do not claim the feature is verified end-to-end in the running app — that requires a rebuild, a server restart, and a Vite restart, and is the user's call.

---

## Self-Review

**Spec coverage:** §1 Data & API → Tasks 1 and 3. §2 Engine & core → Task 2 (the scheduler package is untouched, as specified). §3 Web → Tasks 4 and 5. §4 Testing → the db-mapper test is in Task 1 (written, unrunnable here, with the gap declared); db repo integration test is deliberately NOT included, because the package's tests cannot run in this worktree at all — the spec's flag stands, and the behavior it would cover is exercised by Tasks 2 and 3. Non-goals (no popover option, no Priorities filter, no scheduler change, no backfill) are respected: no task touches them.

**Placeholder scan:** no TBDs; every code step carries real code; every test step carries real assertions. Where a task depends on a fixture that already exists in the target file, the step says to read and reuse it rather than inventing one — that is an instruction, not a placeholder.

**Type consistency:** `toFlexibleTask(row, fallbackDueBy: number)` is defined in Task 1 and called with `horizonEnd.getTime()` in Task 2. `AssembledScheduleInput` is defined in Task 2 and consumed only there. `Task.dueBy: string | null` is defined in Task 4 and consumed by Task 5's `sortBucket<T extends { … dueBy: string | null }>` and `dueShort(iso: string | null)`. `CreateTaskInput.dueBy` is `?: Date | null` in db (Task 1) and `?: string | null` in web (Task 4) — deliberately different types for different layers, matching the existing `notBefore` convention.
