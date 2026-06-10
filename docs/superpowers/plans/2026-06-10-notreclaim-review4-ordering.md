# Review 4: Within-Column Ordering + Planner Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks can be drag-reordered within a Priorities column (`Task.sortOrder` + engine tiebreaker + board insertion DnD); the drawer loses its priority number; new tasks land at the bottom of their column; the planner popover gets bigger; planner blocks show `Task: Subtask` labels.

**Architecture:** Backend first (migration + repo default + mapper + engine sort + zod pass-through), then the board DnD (insertion index + midpoint sortOrder, drawer cleanup), then the planner cosmetics (popover size/anchor, block relabeling). Spec: `docs/superpowers/specs/2026-06-10-notreclaim-review-4-design.md`.

**Branch:** `feat/review4-ordering` off `main`.

**Verified facts:** engine work sort is `priority || tie || id` (`packages/scheduler/src/schedule.ts:45`, task `tie = dueBy`); scheduler tests don't constrain same-priority task/habit interleave; `listByUser` orders `[{priority asc},{dueBy asc}]` and includes subtasks ordered by createdAt; board DnD is column-level (`Board.tsx` drag state, `Column.tsx` onDragOver/onDrop, `Priorities.tsx onMove` no-ops same-bucket); the drawer's Priority FieldBox is the only priority UI; CreatePopover is `absolute left-1 right-1` inside the day column; `Planner.tsx` doesn't fetch tasks yet.

---

### Task 1: sortOrder backbone — db + mapper + engine + server (TDD per package)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (+ create migration `packages/db/prisma/migrations/20260610010000_task_sort_order/migration.sql`)
- Modify: `packages/db/src/repositories/task-repository.ts`, `packages/db/src/mappers.ts`
- Modify: `packages/scheduler/src/types.ts`, `packages/scheduler/src/schedule.ts`
- Modify: `packages/server/src/schemas.ts`, `packages/server/test/fakes.ts`
- Tests: `packages/db/test/repositories/task-repository.test.ts`, `packages/db/test/mappers.test.ts` (if it asserts toFlexibleTask output — check), `packages/scheduler/test/schedule.test.ts`, `packages/server/test/tasks.test.ts`

- [ ] **Step 1: Branch** — `cd /home/nyx-ai/Projects/NotReclaim && git checkout -b feat/review4-ordering main`

- [ ] **Step 2 (db, red):** append to `packages/db/test/repositories/task-repository.test.ts` (reuse its existing fixture helpers — read the file first and follow its `users`/task-input idioms; field names below assume the file's `taskInput`-style helper, adapt to what exists):

```ts
  it('defaults sortOrder to max+1 within the user (bottom of the board)', async () => {
    const user = await users.create({ email: 'so1@example.com' });
    const a = await repo.create(user.id, taskInput({ title: 'A' }));
    expect(a.sortOrder).toBe(1); // empty board → 0 + 1
    const b = await repo.create(user.id, taskInput({ title: 'B' }));
    expect(b.sortOrder).toBe(2);
    const explicit = await repo.create(user.id, taskInput({ title: 'C', sortOrder: 1.5 }));
    expect(explicit.sortOrder).toBe(1.5);
  });

  it('lists by priority, then sortOrder, then dueBy', async () => {
    const user = await users.create({ email: 'so2@example.com' });
    await repo.create(user.id, taskInput({ title: 'second', priority: 2, sortOrder: 5 }));
    await repo.create(user.id, taskInput({ title: 'first', priority: 2, sortOrder: 1 }));
    await repo.create(user.id, taskInput({ title: 'crit', priority: 1, sortOrder: 99 }));
    const titles = (await repo.listByUser(user.id)).map((t) => t.title);
    expect(titles).toEqual(['crit', 'first', 'second']);
  });

  it('updates sortOrder via update()', async () => {
    const user = await users.create({ email: 'so3@example.com' });
    const t = await repo.create(user.id, taskInput({ title: 'T' }));
    const moved = await repo.update(user.id, t.id, { sortOrder: 0.25 });
    expect(moved.sortOrder).toBe(0.25);
  });
```

Run `cd packages/db && npm test` → new tests fail (column/input missing).

- [ ] **Step 3 (db, green):**
  - `schema.prisma` `model Task`: add `sortOrder Float @default(0)` after `priority`.
  - Migration SQL: `ALTER TABLE "Task" ADD COLUMN "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;` then `npx prisma migrate deploy && npx prisma generate` in packages/db (test DB migrates via global-setup).
  - `task-repository.ts`: `CreateTaskInput` and `UpdateTaskInput` gain `sortOrder?: number;` and create becomes:

```ts
    async create(userId: string, data: CreateTaskInput): Promise<Task> {
      let sortOrder = data.sortOrder;
      if (sortOrder === undefined) {
        const agg = await prisma.task.aggregate({ where: { userId }, _max: { sortOrder: true } });
        sortOrder = (agg._max.sortOrder ?? 0) + 1;
      }
      return prisma.task.create({ data: { userId, ...data, sortOrder } });
    },
```

  - `listByUser` orderBy → `[{ priority: 'asc' }, { sortOrder: 'asc' }, { dueBy: 'asc' }]`.
  - `mappers.ts` `toFlexibleTask`: add `sortOrder: row.sortOrder,`.
  - `npm test` in packages/db green; `npm run build`.

- [ ] **Step 4 (engine, red):** append to `packages/scheduler/test/schedule.test.ts` (its `mk` helper at ~line 66 builds same-priority tasks):

```ts
  it('orders same-priority tasks by sortOrder before dueBy', () => {
    const mkT = (id: string, sortOrder: number, dueBy: number) =>
      ({ id, title: id, priority: 1, durationMs: 20, dueBy, minChunkMs: 20, maxChunkMs: 20, sortOrder });
    const res = schedule({
      workingWindows: [{ start: 0, end: 100 }], fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [mkT('late-but-first', 2, 50), mkT('early-but-second', 1, 40)],
    });
    // sortOrder 1 wins the first slot even though the other task's dueBy is later
    expect(res.blocks.map((b) => b.sourceId)).toEqual(['early-but-second', 'late-but-first']);
  });
```

Wait — sortOrder 1 belongs to 'early-but-second': it must be placed FIRST (lower sortOrder). The dueBys (40 vs 50) would have ordered 'early-but-second' first anyway — make the test discriminating: give the LOWER sortOrder to the task with the LATER dueBy:

```ts
    const res = schedule({
      workingWindows: [{ start: 0, end: 100 }], fixedEvents: [], pinnedBlocks: [], habits: [],
      tasks: [mkT('a-late-due', 1, 90), mkT('b-early-due', 2, 50)],
    });
    expect(res.blocks.map((b) => b.sourceId)).toEqual(['a-late-due', 'b-early-due']);
```

(Old behavior would place `b-early-due` first via dueBy; sortOrder must override.) Run `cd packages/scheduler && npm test` → fails.

- [ ] **Step 5 (engine, green):**
  - `types.ts` `FlexibleTask`: add

```ts
  /** User-chosen order among same-priority tasks (board position); lower first. Defaults to 0. */
  sortOrder?: number;
```

  - `schedule.ts`: `WorkItem` variants gain `order: number`; tasks map `order: t.sortOrder ?? 0`, habits `order: 0`; sort becomes

```ts
  work.sort(
    (a, b) => a.priority - b.priority || a.order - b.order || a.tie - b.tie || a.id.localeCompare(b.id),
  );
```

  - `npm test` in packages/scheduler green (all pre-existing tests must pass unchanged — tasks without sortOrder get 0, same as habits → legacy tie order); `npm run build`. Then rebuild db against the new scheduler types: `cd ../db && npm run build`, and `cd ../core && npm test && npm run build` (core consumes the mapper — its fakes may need a `sortOrder` field on Task fixtures ONLY if TypeScript complains; Task fixtures typed as Prisma Task will: add `sortOrder: 0` where the compiler demands).

- [ ] **Step 6 (server, red→green):** append to `packages/server/test/tasks.test.ts`:

```ts
  it('passes sortOrder through create and patch', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` },
      payload: { title: 'T', priority: 4, durationMs: 60_000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 60_000, maxChunkMs: 60_000, sortOrder: 2.5 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().sortOrder).toBe(2.5);
    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${created.json().id}`, headers: { authorization: `Bearer ${token}` }, payload: { sortOrder: 0.5 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().sortOrder).toBe(0.5);
  });
```

Implement: `schemas.ts` `createTaskSchema` gains `sortOrder: z.number().optional(),` (updateTaskSchema inherits via `.partial()`); `test/fakes.ts` `fakeTaskRepo.make` gains `sortOrder: 0` in the defaults (data spread already carries explicit values). Routes already spread the body. `cd packages/server && npm test && npm run build` green.

- [ ] **Step 7: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/db/prisma packages/db/src packages/db/test packages/scheduler/src packages/scheduler/test packages/server/src/schemas.ts packages/server/test/fakes.ts packages/server/test/tasks.test.ts packages/core
git commit -m "feat: Task.sortOrder — within-priority user ordering through db, engine, and API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(If packages/core needed no changes, the pathspec is harmlessly empty — use `git add -A packages/core/src packages/core/test` only when files actually changed; never add untracked root files.)

---

### Task 2: Board within-column drag + drawer priority removal (web, TDD)

**Files:**
- Modify: `packages/web/src/api/types.ts` (Task.sortOrder, input types)
- Modify: `packages/web/src/app/priorities/priorityBucket.ts` (+ its test) — pure `sortBucket` + `insertionSortOrder`
- Modify: `packages/web/src/app/priorities/Board.tsx`, `Column.tsx` (insertion-index DnD + indicator)
- Modify: `packages/web/src/app/pages/Priorities.tsx` (sorted visible columns; onMove with index)
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`, `taskForm.ts` (+ tests) — remove priority
- Tests: `priorityBucket.test.ts`, `Priorities.test.tsx`, `TaskDrawer.test.tsx`, `taskForm.test.ts`

- [ ] **Step 1 (pure model, red→green):** in `priorityBucket.ts`:

```ts
/** Within-bucket display order: user sortOrder, then due date. */
export function sortBucket<T extends { sortOrder: number; dueBy: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || Date.parse(a.dueBy) - Date.parse(b.dueBy));
}

/** sortOrder for inserting at `index` into a sorted bucket (midpoint of neighbors). */
export function insertionSortOrder(sorted: Array<{ sortOrder: number }>, index: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.max(0, Math.min(index, sorted.length));
  if (i === 0) return sorted[0]!.sortOrder - 1;
  if (i === sorted.length) return sorted[sorted.length - 1]!.sortOrder + 1;
  return (sorted[i - 1]!.sortOrder + sorted[i]!.sortOrder) / 2;
}
```

Tests first (in `priorityBucket.test.ts`): sortBucket orders by sortOrder then dueBy; insertionSortOrder top/middle/bottom/empty/clamped-out-of-range cases.

- [ ] **Step 2 (types):** `api/types.ts`: `Task` gains `sortOrder: number;` (REQUIRED — then sweep compile errors in test fixtures by adding `sortOrder: 0`; the suite will point at every site; `task()` fixture helpers in Priorities.test/TaskDrawer.test/TaskRow.test/fakes are the usual suspects). `CreateTaskInput`/`UpdateTaskInput` gain `sortOrder?: number;`.

- [ ] **Step 3 (board DnD, red):** add to `Priorities.test.tsx` (uses the existing `dataTransfer()` helper and drag idioms — read the existing 'drag a task to another column' test and mirror its event sequence):

```tsx
  it('reorders within a column via drag (midpoint sortOrder, same priority)', async () => {
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'a', title: 'Alpha', priority: 2, sortOrder: 1 }),
      task({ id: 'b', title: 'Beta', priority: 2, sortOrder: 2 }),
      task({ id: 'c', title: 'Gamma', priority: 2, sortOrder: 3 }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    const rows = screen.getAllByTestId('task-row');
    const dt = dataTransfer();
    // drag Gamma over the TOP half of Alpha → insertion index 0 → sortOrder 1 - 1 = 0
    fireEvent.dragStart(rows[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt, clientY: 0 });
    fireEvent.drop(screen.getByTestId('column-high'), { dataTransfer: dt });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c', { sortOrder: 0 }));
  });

  it('cross-column drop sets priority AND a bottom sortOrder', async () => {
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'a', title: 'Alpha', priority: 2, sortOrder: 1 }),
      task({ id: 'l', title: 'Lonely', priority: 4, sortOrder: 7 }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getAllByTestId('task-row')[0]!, { dataTransfer: dt }); // Alpha
    fireEvent.dragOver(screen.getByTestId('column-low'), { dataTransfer: dt });       // empty area of low column
    fireEvent.drop(screen.getByTestId('column-low'), { dataTransfer: dt });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('a', { priority: 4, sortOrder: 8 })); // below Lonely
  });
```

Also UPDATE the existing column-move test if it asserts a priority-only patch (it will now include `sortOrder` — check `completes a task…`-adjacent drag test and extend its expectation).

jsdom note: row `getBoundingClientRect` is all-zero → `clientY: 0` is NOT below the midpoint (`r.top + r.height/2` = 0; use `<` strictly → index = row index = insert ABOVE). Make the implementation use `e.clientY < rect.top + rect.height / 2` so clientY 0 with a zero rect yields... 0 < 0 is false → index i+1. CAREFUL: with zero rects the half-test degenerates; implement instead: `const idx = rect.height > 0 && e.clientY >= rect.top + rect.height / 2 ? i + 1 : i;` (degenerate rect → insert above the hovered row — deterministic for tests; the first test then expects index 0 → sortOrder 0 as written).

- [ ] **Step 4 (board DnD, green):**
  - `Board.tsx`: drag state becomes `{ id, over, overIndex }`; `ColumnDnd` gains `overIndex: number | null` and `setOver(k, index)` (merge the two setters: hovering a row reports its insertion index, hovering the column body reports `tasks.length`); `drop(to)` calls `onMove(drag.id, to, drag.overIndex ?? Number.MAX_SAFE_INTEGER)`. `BoardProps.onMove: (taskId: string, to: BucketKey, index: number) => void`.
  - `Column.tsx`: column `onDragOver` keeps `dnd.setOver(bucket, tasks.length)` as the fallback (empty space = end of list); each row gets a wrapper handler `onDragOver={(e) => { if (dnd.id === null) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const idx = r.height > 0 && e.clientY >= r.top + r.height / 2 ? i + 1 : i; dnd.setOver(bucket, idx); }}` — pass it into `TaskRow` as a new `onRowDragOver` prop (TaskRow attaches it to its root div alongside the existing draggable handlers) OR wrap each TaskRow in a plain `<div>` carrying it (choose the wrapper div — zero TaskRow churn; the wrapper is display:contents-free, simple block). Insertion indicator: when `dnd.over === bucket && dnd.overIndex === i`, render `<div data-testid="insert-line" className="h-0.5 bg-indigo" />` before the row (and after the last row when `overIndex === tasks.length`).
  - `Priorities.tsx`: build VISIBLE columns with `sortBucket` (`tasks: sortBucket(visible.filter(...bucket...))`); `onMove(taskId, to, index)`:

```ts
  const onMove = (taskId: string, to: BucketKey, index: number) => {
    const all = tasksQ.data ?? [];
    const t = all.find((x) => x.id === taskId);
    if (!t) return;
    const column = columns.find((c) => c.key === to);
    const neighbors = (column?.tasks ?? []).filter((x) => x.id !== taskId);
    const sortOrder = insertionSortOrder(neighbors, index);
    const patch: UpdateTaskInput = { sortOrder };
    if (priorityToBucket(t.priority) !== to) patch.priority = bucketToPriority(to);
    updateM.mutate({ id: taskId, patch });
  };
```

(`columns` already filtered+sorted; same-bucket reorder no longer early-returns. If `to`'s column is hidden via colsVisible it can't be a drop target — columns render only when visible.)

- [ ] **Step 5 (drawer/priority removal, red→green):** `taskForm.ts`: remove `priority` from `TaskFormState`, `toFormState`, `toUpdateInput` (and any validation mention); `taskForm.test.ts`: update expectations (patch no longer contains priority). `TaskDrawer.tsx`: delete the Priority FieldBox. `TaskDrawer.test.tsx`: the prefill/save test's `objectContaining` must drop `priority: 2`. Priorities.test drag tests above already cover the new priority path.

- [ ] **Step 6: gates + commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web && npm test && npx tsc -p tsconfig.json --noEmit
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src
git commit -m "feat(web): drag-to-reorder tasks within a Priorities column; drawer drops the priority number

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Planner polish — bigger popover + Task:Subtask block labels (web, TDD)

**Files:**
- Modify: `packages/web/src/app/planner/CreatePopover.tsx` (+ test), `packages/web/src/app/planner/WeekGrid.tsx`
- Create: `packages/web/src/app/planner/blockLabels.ts` + `blockLabels.test.ts`
- Modify: `packages/web/src/app/pages/Planner.tsx` (+ `Planner.test.tsx`)

- [ ] **Step 1 (popover size/anchor):** `CreatePopover` gains `align?: 'left' | 'right'` (default `'left'`); root className becomes `absolute z-40 w-[340px] animate-pop rounded-[14px] border border-line bg-card p-4 shadow-pop ${align === 'left' ? 'left-1' : 'right-1'}` (drops `left-1 right-1` full-bleed). Scale up: tabs `py-1.5 text-[14px]`, title input `px-3 py-2 text-[15px]`, DurationStepper `size={22}`, slot label `text-[13px]`, submit `py-2 text-[14px]`. `WeekGrid` passes `align={i <= 3 ? 'left' : 'right'}`. Test (CreatePopover.test): `align="right"` renders class `right-1` and not `left-1`; default renders `left-1`; width class present. (Class-string assertions are acceptable here — they ARE the deliverable.)

- [ ] **Step 2 (labels, red):** `blockLabels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ScheduledBlock, Task } from '../../api/types';
import { labelBlocksWithSubtasks } from './blockLabels';

const block = (id: string, taskId: string | null, startsAt: string): ScheduledBlock =>
  ({ id, userId: 'u', taskId, habitId: taskId ? null : 'h1', title: 'Write report', startsAt, endsAt: startsAt, pinned: false, engineKey: null } as ScheduledBlock);
const task = (id: string, title: string, subtasks: Array<{ id: string; title: string; done: boolean }>): Task =>
  ({ id, userId: 'u', title, priority: 2, sortOrder: 0, durationMs: 1, dueBy: '', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '', subtasks: subtasks.map((s) => ({ ...s, taskId: id })) } as Task);

describe('labelBlocksWithSubtasks', () => {
  it('labels a task’s blocks with its open subtasks in start order', () => {
    const blocks = [
      block('b2', 't1', '2026-01-06T10:00:00.000Z'),
      block('b1', 't1', '2026-01-05T09:00:00.000Z'),
      block('b3', 't1', '2026-01-07T10:00:00.000Z'),
    ];
    const tasks = [task('t1', 'Write report', [
      { id: 's0', title: 'done already', done: true },
      { id: 's1', title: 'outline', done: false },
      { id: 's2', title: 'draft', done: false },
    ])];
    const out = labelBlocksWithSubtasks(blocks, tasks);
    const byId = Object.fromEntries(out.map((b) => [b.id, b.title]));
    expect(byId['b1']).toBe('Write report: outline'); // earliest block ← first open subtask
    expect(byId['b2']).toBe('Write report: draft');
    expect(byId['b3']).toBe('Write report');          // more blocks than open subtasks → plain title
  });

  it('leaves habit blocks and tasks without open subtasks untouched (same array when nothing applies)', () => {
    const blocks = [block('b1', null, '2026-01-05T09:00:00.000Z')];
    expect(labelBlocksWithSubtasks(blocks, [task('t1', 'X', [])])).toBe(blocks);
  });
});
```

- [ ] **Step 3 (labels, green):** `blockLabels.ts`:

```ts
import type { ScheduledBlock, Task } from '../../api/types';

/** Display-only: relabel each task's blocks (in start order) with its open subtasks (in list order) as "Task: Subtask". */
export function labelBlocksWithSubtasks(blocks: ScheduledBlock[], tasks: Task[]): ScheduledBlock[] {
  const labels = new Map<string, string>();
  for (const t of tasks) {
    const open = (t.subtasks ?? []).filter((s) => !s.done);
    if (open.length === 0) continue;
    const own = blocks
      .filter((b) => b.taskId === t.id)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    own.forEach((b, i) => { if (i < open.length) labels.set(b.id, `${t.title}: ${open[i]!.title}`); });
  }
  if (labels.size === 0) return blocks;
  return blocks.map((b) => (labels.has(b.id) ? { ...b, title: labels.get(b.id)! } : b));
}
```

- [ ] **Step 4 (Planner wiring):** `Planner.tsx`: add `useTasksQuery` (merge import), `const tasksQ = useTasksQuery();` and feed WeekGrid `blocks={labelBlocksWithSubtasks(scheduleQ.data ?? [], tasksQ.data ?? [])}` (wrap in `useMemo` keyed on the two datas, matching the file's style). `Planner.test.tsx`: add one test — fake `getSchedule` returns one task block, fake `listTasks` returns that task with an open subtask, assert the rendered block shows `Task: subtask` text (read the file's existing fakes/render idioms first; `listTasks` may already be stubbed in its makeApi — extend).

- [ ] **Step 5: gates + commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web && npm test && npx tsc -p tsconfig.json --noEmit
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src
git commit -m "feat(web): bigger planner create popover + Task:Subtask block labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Full suite + live verification + merge

- [ ] `cd /home/nyx-ai/Projects/NotReclaim && npm test` — all workspaces green.
- [ ] Apply the migration to the dev DB (`cd packages/db && npx prisma migrate deploy`), `npm run build` at root, restart the API server (`.env.run`).
- [ ] Live (geckodriver, see memory for the harness): within-column drag PATCHes sortOrder and the column re-orders; new task lands at the bottom of Low; drawer has no Priority field; popover is 340px and right-aligned on Fri–Sun; a task with open subtasks shows `Task: Subtask` on its planner blocks.
- [ ] Merge `feat/review4-ordering` into main, suite green, delete branch.
