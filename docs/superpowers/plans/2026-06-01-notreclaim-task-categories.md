# Task Categories as Scheduling "Hours" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a task's category a first-class "Hours" policy — each category owns weekly time windows, and the engine schedules a task only inside its category's windows; a seeded default "Working Hours" category inherits `Settings.workingHours`.

**Architecture:** New `Category` entity (per user, nullable `windows` JSON; `null` = inherit Settings). `Task.category` (free text) → `Task.categoryId` (FK, `onDelete: SetNull`). The engine gains `FlexibleTask.allowedWindows` (mirroring the habit restriction that already exists — one extra arg to `placeItem`). `assemble` builds the schedulable envelope as the **union** of all categories' windows and tags each task with its category's expanded windows. Server gets category CRUD; web gets a category picker in the New Task modal + edit drawer and a "Categories" section on the Settings page.

**Tech Stack:** TypeScript ESM (strict, `noUncheckedIndexedAccess`); Prisma + Postgres; Fastify; React + Vite + Tailwind v3 + TanStack Query; vitest + @testing-library/react@16 + jsdom.

**Conventions (every task):** Backend imports use explicit `.js` extensions; `packages/web` imports are EXTENSIONLESS and NEVER `import React` (named hooks from `'react'` are fine). Tailwind v3 literal utility classes. DI + injected `now` (no `Date.now()` in pure modules). Per-package test run: `npm test -w @notreclaim/<pkg>`. Web tests pin `TZ=UTC`; web build = `tsc -p tsconfig.json && vite build`. Do NOT commit `seed-dev.mjs` / `.env.run` / `.env.test` / `design_handoff_notreclaim/` / `review/` / `.claude/`.

**Sequencing note:** Tasks are backend→engine→core→server→web. Because Task 1 changes the generated Prisma `Task` type (`category` → `categoryId`), cross-package typechecks for server/core/web will be red until their dependent task lands. The gate per task is that task's **own package** tests; Task 9 runs the full monorepo green.

**Branch:** `feat/task-categories` (spec committed at `bc53bc1`).

---

## File Structure

- `packages/db/prisma/schema.prisma` — add `Category` model; `Task.category` → `categoryId` + relation; `User.categories` back-ref.
- `packages/db/prisma/migrations/<ts>_categories/` — generated migration.
- `packages/db/src/repositories/category-repository.ts` — **new** CategoryRepository.
- `packages/db/src/repositories/task-repository.ts` — `category` → `categoryId` in inputs.
- `packages/db/src/index.ts` — export CategoryRepository + `Category` type.
- `packages/db/test/setup-each.ts` — add `Category` to TRUNCATE list.
- `packages/db/test/repositories/category-repository.test.ts` — **new** tests.
- `packages/scheduler/src/types.ts` — `FlexibleTask.allowedWindows?`.
- `packages/scheduler/src/items.ts` — pass `allowedWindows` to `placeItem`.
- `packages/scheduler/test/items.test.ts` — append allowed-windows tests.
- `packages/core/src/assemble.ts` — `categories` dep, union envelope, per-task `allowedWindows`.
- `packages/core/test/fakes.ts` + `assemble.test.ts` — categories fakes + tests.
- `packages/server/src/schemas.ts` — category schemas; task `category` → `categoryId`.
- `packages/server/src/category-routes.ts` — **new** CRUD routes.
- `packages/server/src/app.ts` + `server.ts` — wire repo + routes.
- `packages/server/test/fakes.ts` + `category-routes.test.ts` — fake repo + tests.
- `packages/web/src/api/types.ts`, `client.ts`, `queries.ts`, `test/fakes.tsx` — Category DTOs/methods/hooks.
- `packages/web/src/app/shell/{newTaskForm.ts,NewTaskModal.tsx}` (+ tests) — picker + create.
- `packages/web/src/app/tasks/{taskForm.ts,TaskDrawer.tsx}` (+ tests) — picker.
- `packages/web/src/app/settings/{WeeklyHoursEditor.tsx,SettingsForm.tsx,CategoriesSection.tsx,categoryForm.ts}` (+ tests) + `app/pages/Settings.tsx` — manage categories.

---

## Task 1: DB — `Category` model, migration, repository

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/repositories/category-repository.ts`
- Modify: `packages/db/src/repositories/task-repository.ts:11,21`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/test/setup-each.ts`
- Create: `packages/db/test/repositories/category-repository.test.ts`

- [ ] **Step 1: Edit the Prisma schema**

In `model Task`, **remove** `category     String?` and add:

```prisma
  categoryId   String?
```

and in the relations area of `model Task` (next to `user ... scheduledBlocks ...`) add:

```prisma
  category        Category?        @relation(fields: [categoryId], references: [id], onDelete: SetNull)
```

In `model User`, add a back-reference alongside its other relation fields (e.g. `tasks`, `habits`):

```prisma
  categories Category[]
```

Add the new model (after `model Task { ... }`):

```prisma
model Category {
  id        String   @id @default(uuid())
  userId    String
  name      String
  windows   Json?
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@unique([userId, name])
}
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd packages/db
set -a; . ./.env.test; set +a               # loads TEST_DATABASE_URL from .env.test
export DATABASE_URL="$TEST_DATABASE_URL"
npx prisma migrate dev --name categories
```

Expected: a new folder `prisma/migrations/<timestamp>_categories/migration.sql`, the migration applied, and `prisma generate` run automatically (the client now has a `Category` delegate and `Task.categoryId`). If Prisma reports it cannot create the shadow database, the local userspace cluster owner has `CREATEDB` rights — re-run; or add `shadowDatabaseUrl` to the `datasource` block pointing at a `notreclaim_shadow` DB.

- [ ] **Step 3: Add `Category` to the test TRUNCATE list**

In `packages/db/test/setup-each.ts`, add `'Category',` to the `TABLES` array (place it right after `'Task',`):

```ts
const TABLES = [
  'ScheduledBlock',
  'CalendarEvent',
  'Task',
  'Category',
  'Habit',
  'Settings',
  'User',
];
```

- [ ] **Step 4: Write the failing repository test**

Create `packages/db/test/repositories/category-repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/client.js';
import { ConflictError, NotFoundError } from '../../src/errors.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { createCategoryRepository } from '../../src/repositories/category-repository.js';

const users = createUserRepository(prisma);
const tasks = createTaskRepository(prisma);
const repo = createCategoryRepository(prisma);

const windows = [{ weekday: 1, startMinute: 1080, endMinute: 1320 }]; // Mon 18:00–22:00

describe('CategoryRepository', () => {
  it('ensureDefault is idempotent and creates a windows-null default', async () => {
    const user = await users.create({ email: 'c1@example.com' });
    const a = await repo.ensureDefault(user.id);
    const b = await repo.ensureDefault(user.id);
    expect(a.id).toBe(b.id);
    expect(a.isDefault).toBe(true);
    expect(a.name).toBe('Working Hours');
    expect(a.windows).toBeNull();
  });

  it('creates non-default categories and lists default first then by name', async () => {
    const user = await users.create({ email: 'c2@example.com' });
    await repo.ensureDefault(user.id);
    await repo.create(user.id, { name: 'Zeta', windows });
    await repo.create(user.id, { name: 'Alpha', windows });
    const list = await repo.listByUser(user.id);
    expect(list.map((c) => c.name)).toEqual(['Working Hours', 'Alpha', 'Zeta']);
    expect(list[1]!.windows).toEqual(windows);
  });

  it('rejects a duplicate name and an unknown id', async () => {
    const user = await users.create({ email: 'c3@example.com' });
    await repo.create(user.id, { name: 'Focus', windows });
    await expect(repo.create(user.id, { name: 'Focus', windows })).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.update(user.id, 'missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to delete the default category', async () => {
    const user = await users.create({ email: 'c4@example.com' });
    const def = await repo.ensureDefault(user.id);
    await expect(repo.delete(user.id, def.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('nulls a task\'s categoryId when its category is deleted', async () => {
    const user = await users.create({ email: 'c5@example.com' });
    const cat = await repo.create(user.id, { name: 'Errands', windows });
    const task = await tasks.create(user.id, {
      title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1, categoryId: cat.id,
    });
    await repo.delete(user.id, cat.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.categoryId).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -w @notreclaim/db -- category-repository`
Expected: FAIL — `createCategoryRepository`/`categoryId` not defined.

- [ ] **Step 6: Implement the repository**

Create `packages/db/src/repositories/category-repository.ts`:

```ts
import { Prisma, type PrismaClient, type Category } from '@prisma/client';
import { NotFoundError, ConflictError, translatePrismaError } from '../errors.js';

export interface CreateCategoryInput {
  name: string;
  windows: Prisma.InputJsonValue; // WorkingHourEntry[]
}

export interface UpdateCategoryInput {
  name?: string;
  windows?: Prisma.InputJsonValue;
}

export function createCategoryRepository(prisma: PrismaClient) {
  return {
    listByUser(userId: string): Promise<Category[]> {
      return prisma.category.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    },

    getDefault(userId: string): Promise<Category | null> {
      return prisma.category.findFirst({ where: { userId, isDefault: true } });
    },

    async ensureDefault(userId: string): Promise<Category> {
      const existing = await prisma.category.findFirst({ where: { userId, isDefault: true } });
      if (existing) return existing;
      try {
        return await prisma.category.create({
          data: { userId, name: 'Working Hours', windows: Prisma.DbNull, isDefault: true },
        });
      } catch (error) {
        const row = await prisma.category.findFirst({ where: { userId, isDefault: true } });
        if (row) return row; // lost a concurrent create race
        translatePrismaError(error);
      }
    },

    async create(userId: string, data: CreateCategoryInput): Promise<Category> {
      try {
        return await prisma.category.create({
          data: { userId, name: data.name, windows: data.windows, isDefault: false },
        });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    async update(userId: string, id: string, data: UpdateCategoryInput): Promise<Category> {
      try {
        const result = await prisma.category.updateMany({ where: { id, userId }, data });
        if (result.count === 0) throw new NotFoundError(`Category ${id} not found for user`);
        return await prisma.category.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const row = await prisma.category.findFirst({ where: { id, userId } });
      if (!row) throw new NotFoundError(`Category ${id} not found for user`);
      if (row.isDefault) throw new ConflictError('The default category cannot be deleted');
      await prisma.category.deleteMany({ where: { id, userId } });
    },
  };
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;
```

- [ ] **Step 7: Update the task-repository inputs**

In `packages/db/src/repositories/task-repository.ts`, change `category?: string | null;` to `categoryId?: string | null;` in **both** `CreateTaskInput` (line 11) and `UpdateTaskInput` (line 21).

- [ ] **Step 8: Export from the db index**

In `packages/db/src/index.ts`, add after the task-repository exports:

```ts
export { createCategoryRepository } from './repositories/category-repository.js';
export type { CategoryRepository, CreateCategoryInput, UpdateCategoryInput } from './repositories/category-repository.js';
```

and add `Category,` to the `export type { User, Settings, ... }` block from `@prisma/client`.

- [ ] **Step 9: Run the tests**

Run: `npm test -w @notreclaim/db`
Expected: PASS (all repository tests, including the 5 new category tests).

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): Category model + repository; Task.categoryId FK"
```

---

## Task 2: Engine — `FlexibleTask.allowedWindows`

**Files:**
- Modify: `packages/scheduler/src/types.ts`
- Modify: `packages/scheduler/src/items.ts:19`
- Modify: `packages/scheduler/test/items.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/scheduler/test/items.test.ts` (it already imports `scheduleTask`; if not, add `import { scheduleTask } from '../src/items.js';`):

```ts
describe('scheduleTask allowedWindows', () => {
  const H = 3_600_000;
  const baseTask = { id: 't1', title: 'T', priority: 1, durationMs: H, dueBy: 10 * H, minChunkMs: H, maxChunkMs: H };

  it('confines placement to the allowed windows', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], { ...baseTask, allowedWindows: [{ start: 3 * H, end: 5 * H }] });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ start: 3 * H, end: 4 * H });
    expect(res.unscheduled).toHaveLength(0);
  });

  it('leaves the chunk unscheduled when it cannot fit the allowed windows', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], { ...baseTask, allowedWindows: [{ start: 3 * H, end: 3 * H + 30 * 60_000 }] });
    expect(res.blocks).toHaveLength(0);
    expect(res.unscheduled[0]).toMatchObject({ sourceId: 't1', remainingMs: H });
  });

  it('places at the earliest free slot when allowedWindows is omitted (regression)', () => {
    const res = scheduleTask([{ start: 0, end: 10 * H }], baseTask);
    expect(res.blocks[0]).toMatchObject({ start: 0, end: H });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/scheduler -- items`
Expected: FAIL — `allowedWindows` is not an accepted property / placement ignores it.

- [ ] **Step 3: Add the type field**

In `packages/scheduler/src/types.ts`, inside `interface FlexibleTask` (after `maxChunkMs`), add:

```ts
  /**
   * Optional HARD restriction: placement is confined to these windows
   * (intersected with free time before the due date). A chunk that cannot fit
   * is left unscheduled. Omit for unrestricted placement (previous behavior).
   */
  allowedWindows?: Interval[];
```

- [ ] **Step 4: Pass the windows to `placeItem`**

In `packages/scheduler/src/items.ts`, change line 19 from:

```ts
  const result = placeItem(free, chunkSizes, task.dueBy);
```

to:

```ts
  const result = placeItem(free, chunkSizes, task.dueBy, task.allowedWindows);
```

(`placeItem`'s 4th `candidateWindows` arg already intersects with the remaining free time; `undefined` preserves today's behavior.)

- [ ] **Step 5: Run the tests**

Run: `npm test -w @notreclaim/scheduler`
Expected: PASS (all scheduler tests, including the 3 new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler
git commit -m "feat(scheduler): FlexibleTask.allowedWindows confines task placement"
```

---

## Task 3: Core — `assemble` categories, union envelope, per-task windows

**Files:**
- Modify: `packages/core/src/assemble.ts`
- Modify: `packages/core/test/fakes.ts`
- Modify: `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Write the failing tests**

First update the fakes. In `packages/core/test/fakes.ts`:

- add `Category` to the db import: `import type { Settings, CalendarEvent, Task, Habit, ScheduledBlock, Category } from '@notreclaim/db';`
- add `categories?: Category[];` to `interface FakeData`;
- add to the object returned by `fakeRepos`: `categories: { listByUser: async () => data.categories ?? [] },`
- change `makeTask`'s `category: null,` to `categoryId: null,`
- append a `makeCategory` helper:

```ts
export function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-default',
    userId: 'u1',
    name: 'Working Hours',
    windows: null,
    isDefault: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}
```

Then append to `packages/core/test/assemble.test.ts` (reuse its existing imports of `assembleScheduleInput`, `fakeRepos`, `makeSettings`, `makeTask`; add `makeCategory` to the fakes import):

```ts
describe('assembleScheduleInput categories', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  // Settings: Mon 09:00–17:00 (540–1020).
  const settings = makeSettings({ workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as never });

  it('builds the envelope as the union of all category windows', async () => {
    const evening = makeCategory({ id: 'cat-eve', name: 'Personal', isDefault: false, windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] as never });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory(), evening], tasks: [], habits: [] }),
      'u1',
      NOW,
    );
    // Monday 18:00–22:00 is reachable in the envelope even though working hours end at 17:00.
    const mon18 = Date.parse('2026-01-05T18:00:00.000Z');
    expect(input.workingWindows.some((w) => w.start <= mon18 && w.end >= mon18 + 60 * 60_000)).toBe(true);
  });

  it('tags a task with its category windows and the default with settings hours', async () => {
    const evening = makeCategory({ id: 'cat-eve', name: 'Personal', isDefault: false, windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] as never });
    const t1 = makeTask({ id: 't1', categoryId: 'cat-eve' });
    const t2 = makeTask({ id: 't2', categoryId: null });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory(), evening], tasks: [t1, t2], habits: [] }),
      'u1',
      NOW,
    );
    const eveStart = Date.parse('2026-01-05T18:00:00.000Z');
    const workStart = Date.parse('2026-01-05T09:00:00.000Z');
    const a1 = input.tasks.find((t) => t.id === 't1')!.allowedWindows!;
    const a2 = input.tasks.find((t) => t.id === 't2')!.allowedWindows!;
    expect(a1.some((w) => w.start === eveStart)).toBe(true);
    expect(a2.some((w) => w.start === workStart)).toBe(true);
    expect(a2.some((w) => w.start === eveStart)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/core -- assemble`
Expected: FAIL — `categories` not on the repo type / `allowedWindows` undefined.

- [ ] **Step 3: Implement the assemble changes**

In `packages/core/src/assemble.ts`:

Add `Category`/`CategoryRepository` to the db type import and `mergeIntervals` to the scheduler import:

```ts
import type {
  ScheduleInput,
  FixedEvent,
  FlexibleTask,
  Habit as EngineHabit,
  ScheduledBlock as EngineScheduledBlock,
  Interval,
} from '@notreclaim/scheduler';
import { mergeIntervals } from '@notreclaim/scheduler';
```

```ts
import type {
  SettingsRepository,
  CalendarEventRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
  CategoryRepository,
  TaskStatus,
} from '@notreclaim/db';
```

Add the dep to `SchedulingRepositories`:

```ts
  categories: Pick<CategoryRepository, 'listByUser'>;
```

After `workingWindows` is computed (the `expandWorkingWindows(...)` call), insert:

```ts
  const categories = await repos.categories.listByUser(userId);
  const settingsEntries = settings.workingHours as unknown as WorkingHourEntry[];
  const expandedByCategoryId = new Map<string, Interval[]>();
  for (const c of categories) {
    const entries = (c.windows as unknown as WorkingHourEntry[] | null) ?? settingsEntries;
    expandedByCategoryId.set(c.id, expandWorkingWindows(entries, settings.timezone, now, horizonDays));
  }
  const defaultCategoryId = categories.find((c) => c.isDefault)?.id ?? null;

  // Schedulable envelope = union of working hours and every category's windows.
  const envelope = mergeIntervals([
    ...workingWindows,
    ...categories.flatMap((c) => expandedByCategoryId.get(c.id) ?? []),
  ]);
```

Resolve each task's windows. Replace the existing `tasks.push({ ...flexible, durationMs: remaining });` loop body so it also attaches `allowedWindows`:

```ts
  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = [];
  for (const t of allTasks) {
    if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
    const flexible = toFlexibleTask(t);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0);
    if (remaining <= 0) continue;
    const resolvedId =
      t.categoryId && expandedByCategoryId.has(t.categoryId) ? t.categoryId : defaultCategoryId;
    const allowedWindows = resolvedId ? expandedByCategoryId.get(resolvedId)! : workingWindows;
    tasks.push({ ...flexible, durationMs: remaining, allowedWindows });
  }
```

Finally, return the envelope as `workingWindows`:

```ts
  return { workingWindows: envelope, fixedEvents, pinnedBlocks, tasks, habits };
```

(Keep the original `const workingWindows = expandWorkingWindows(...)` binding — it is reused above as the default-category fallback and as a member of the `envelope` union.)

- [ ] **Step 4: Run the tests**

Run: `npm test -w @notreclaim/core`
Expected: PASS. (Existing assemble tests still pass: with zero categories the envelope equals the merged working windows and each task's `allowedWindows` equals those windows — an intersection no-op against `free`.)

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): assemble category windows into union envelope + per-task allowedWindows"
```

---

## Task 4: Server — category schemas, routes, wiring

**Files:**
- Modify: `packages/server/src/schemas.ts`
- Create: `packages/server/src/category-routes.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/test/fakes.ts`
- Create: `packages/server/test/category-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

First extend the server fakes. In `packages/server/test/fakes.ts`:

- add `Category` to the db type import (`import type { Settings, Task, Habit, ScheduledBlock, CalendarEvent, User, Category } from '@notreclaim/db';`);
- in `fakeTaskRepo`'s `make`, change `category: null,` to `categoryId: null,`;
- add a fake category repo factory:

```ts
export function fakeCategoryRepo(seed: Category[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Category => ({
    id: `cat-${++n}`, userId, name: '', windows: null, isDefault: false,
    createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Category;
  return {
    async listByUser(userId: string): Promise<Category[]> {
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    },
    async getDefault(userId: string): Promise<Category | null> {
      return rows.find((r) => r.userId === userId && r.isDefault) ?? null;
    },
    async ensureDefault(userId: string): Promise<Category> {
      const found = rows.find((r) => r.userId === userId && r.isDefault);
      if (found) return found;
      const row = make(userId, { name: 'Working Hours', windows: null, isDefault: true });
      rows.push(row); return row;
    },
    async create(userId: string, data: Record<string, unknown>): Promise<Category> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Category> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Category ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Category ${id}`); }
      if (row.isDefault) { const { ConflictError } = await import('@notreclaim/db'); throw new ConflictError('The default category cannot be deleted'); }
      rows = rows.filter((r) => r.id !== id);
    },
  };
}
```

- in `TestAppOptions`, add `categories?: Category[];`
- in `buildTestApp`, add `const categories = fakeCategoryRepo(opts.categories ?? []);`, include `categories` in **both** the `repos` object passed to `buildApp` **and** the default `schedulingRepos` object, and return `categories` from `buildTestApp`.

Now create `packages/server/test/category-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const windows = [{ weekday: 1, startMinute: 1080, endMinute: 1320 }];

describe('category routes', () => {
  it('GET /categories ensures and returns a default category', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ name: string; isDefault: boolean }>;
    expect(list.some((c) => c.isDefault && c.name === 'Working Hours')).toBe(true);
  });

  it('POST /categories creates a category and triggers a re-plan', async () => {
    const { app, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Personal', windows },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Personal', isDefault: false });
    expect(reconcileCalls).toHaveLength(1);
  });

  it('rejects invalid windows with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bad', windows: [{ weekday: 9, startMinute: 0, endMinute: 10 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when deleting the default category', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const def = await categories.ensureDefault('u1');
    const res = await app.inject({ method: 'DELETE', url: `/categories/${def.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for another user\'s category', async () => {
    const { app } = buildTestApp({ categories: [{ id: 'cat-x', userId: 'other', name: 'X', windows: null, isDefault: false, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'PATCH', url: '/categories/cat-x', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Y' } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/server -- category-routes`
Expected: FAIL — `/categories` routes return 404 (not registered).

- [ ] **Step 3: Add the schemas**

In `packages/server/src/schemas.ts`, add (after `settingsSchema`):

```ts
export const workingHourEntrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
}).refine((w) => w.startMinute < w.endMinute, { message: 'startMinute must be before endMinute' });

export const createCategorySchema = z.object({
  name: z.string().min(1),
  windows: z.array(workingHourEntrySchema).min(1),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  windows: z.array(workingHourEntrySchema).min(1).optional(),
}).refine((b) => b.name !== undefined || b.windows !== undefined, { message: 'name or windows is required' });
```

In the same file, change `createTaskSchema`'s `category: z.string().nullable().optional(),` to:

```ts
  categoryId: z.string().nullable().optional(),
```

- [ ] **Step 4: Create the routes**

Create `packages/server/src/category-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { idParamSchema, createCategorySchema, updateCategorySchema } from './schemas.js';

export function registerCategoryRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/categories', guard, async (request) => {
    await deps.repos.categories.ensureDefault(request.userId);
    return deps.repos.categories.listByUser(request.userId);
  });

  app.post('/categories', guard, async (request, reply) => {
    const body = createCategorySchema.parse(request.body);
    const category = await deps.repos.categories.create(request.userId, body);
    afterMutation(request.userId);
    reply.code(201);
    return category;
  });

  app.patch('/categories/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateCategorySchema.parse(request.body);
    const category = await deps.repos.categories.update(request.userId, id, body);
    afterMutation(request.userId);
    return category;
  });

  app.delete('/categories/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.categories.delete(request.userId, id);
    afterMutation(request.userId);
    reply.code(204).send();
  });
}
```

- [ ] **Step 5: Wire `AppDeps` + registration in `app.ts`**

In `packages/server/src/app.ts`:

- add `CategoryRepository` to the db type import;
- add to `AppDeps.repos`: `categories: CategoryRepository;`
- import the routes: `import { registerCategoryRoutes } from './category-routes.js';`
- register them (after `registerScheduleRoutes(...)`): `registerCategoryRoutes(app, deps, afterMutation);`

- [ ] **Step 6: Wire the real repo in `server.ts`**

In `packages/server/src/server.ts`:

- add `createCategoryRepository` to the `@notreclaim/db` import;
- after `const calendarSyncState = ...`: `const categories = createCategoryRepository(prisma);`
- add `categories` to the `schedulingRepos` object: `const schedulingRepos = { settings, calendarEvents, tasks, habits, scheduledBlocks, categories };`
- add `categories` to `repos` in the `buildApp({ repos: { ... } })` call.

- [ ] **Step 7: Run the tests**

Run: `npm test -w @notreclaim/server`
Expected: PASS (all server tests, including the 5 new category-route tests; existing task tests pass with `categoryId`).

- [ ] **Step 8: Commit**

```bash
git add packages/server
git commit -m "feat(server): category CRUD routes + ensureDefault + task categoryId"
```

---

## Task 5: Web API layer — Category DTOs, client, queries

**Files:**
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/api/queries.ts`
- Modify: `packages/web/src/test/fakes.tsx`
- Create: `packages/web/src/api/categories.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/api/categories.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { useCategoriesQuery, useCreateCategoryMutation } from './queries';

function wrap(api: ReturnType<typeof fakeApiClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><ApiProvider client={api}>{children}</ApiProvider></QueryClientProvider>
  );
}

describe('category queries', () => {
  it('useCategoriesQuery lists categories', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([{ id: 'c1', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]) } as never);
    const { result } = renderHook(() => useCategoriesQuery(), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]!.name).toBe('Working Hours');
  });

  it('useCreateCategoryMutation calls createCategory', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'c2', userId: 'u', name: 'Personal', windows: [], isDefault: false });
    const api = fakeApiClient({ createCategory } as never);
    const { result } = renderHook(() => useCreateCategoryMutation(), { wrapper: wrap(api) });
    result.current.mutate({ name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] });
    await waitFor(() => expect(createCategory).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @notreclaim/web -- categories.test`
Expected: FAIL — `useCategoriesQuery`/`listCategories` not defined.

- [ ] **Step 3: Add the DTOs**

In `packages/web/src/api/types.ts`:

- change `Task`'s `category: string | null;` to `categoryId: string | null;`
- change `CreateTaskInput`'s `category?: string | null;` to `categoryId?: string | null;`
- add (after `WorkingHour`):

```ts
export interface Category {
  id: string;
  userId: string;
  name: string;
  windows: WorkingHour[] | null;
  isDefault: boolean;
}

export interface CreateCategoryInput {
  name: string;
  windows: WorkingHour[];
}
export interface UpdateCategoryInput {
  name?: string;
  windows?: WorkingHour[];
}
```

- [ ] **Step 4: Add the client methods**

In `packages/web/src/api/client.ts`:

- add `Category, CreateCategoryInput, UpdateCategoryInput` to the type import;
- add to the `ApiClient` interface:

```ts
  listCategories(): Promise<Category[]>;
  createCategory(body: CreateCategoryInput): Promise<Category>;
  updateCategory(id: string, patch: UpdateCategoryInput): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
```

- add to the returned object in `createApiClient`:

```ts
    listCategories: () => request('GET', '/categories'),
    createCategory: (body) => request('POST', '/categories', body),
    updateCategory: (id, patch) => request('PATCH', `/categories/${id}`, patch),
    deleteCategory: (id) => request('DELETE', `/categories/${id}`),
```

- [ ] **Step 5: Add the fake base entries**

In `packages/web/src/test/fakes.tsx`, add to the `base` object inside `fakeApiClient`:

```ts
    listCategories: notImplemented('listCategories'),
    createCategory: notImplemented('createCategory'),
    updateCategory: notImplemented('updateCategory'),
    deleteCategory: notImplemented('deleteCategory'),
```

- [ ] **Step 6: Add the query/mutation hooks**

In `packages/web/src/api/queries.ts`:

- add `Category` key + import the input types (`CreateCategoryInput, UpdateCategoryInput`) to the existing `import type { ... } from './types';`
- add to `queryKeys`: `categoriesRoot: ['categories'] as const, categories: () => ['categories'] as const,`
- append:

```ts
export function useCategoriesQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.categories(), queryFn: () => api.listCategories() });
}

function invalidateCategories(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.categoriesRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}

export function useCreateCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateCategoryInput) => api.createCategory(body), onSuccess: () => invalidateCategories(qc) });
}
export function useUpdateCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateCategoryInput }) => api.updateCategory(id, patch), onSuccess: () => invalidateCategories(qc) });
}
export function useDeleteCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteCategory(id), onSuccess: () => invalidateCategories(qc) });
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -w @notreclaim/web -- categories.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api packages/web/src/test/fakes.tsx
git commit -m "feat(web): Category DTOs, client methods, and query/mutation hooks"
```

---

## Task 6: Web — New Task modal category picker + create

**Files:**
- Modify: `packages/web/src/app/shell/newTaskForm.ts`
- Modify: `packages/web/src/app/shell/NewTaskModal.tsx`
- Modify: `packages/web/src/app/shell/newTaskForm.test.ts`
- Modify: `packages/web/src/app/shell/NewTaskModal.test.tsx`

- [ ] **Step 1: Write the failing form test**

Append to `packages/web/src/app/shell/newTaskForm.test.ts`:

```ts
it('carries categoryId through to the create input', () => {
  const base = defaultNewTaskForm(Date.parse('2026-01-05T00:00:00.000Z'));
  const out = toCreateTaskInput({ ...base, title: 'X', categoryId: 'cat-9' });
  expect(out.categoryId).toBe('cat-9');
});
```

- [ ] **Step 2: Update `newTaskForm.ts`**

In `packages/web/src/app/shell/newTaskForm.ts`:

- add `categoryId: string | null;` to `interface NewTaskFormState`;
- add `categoryId: null,` to the object returned by `defaultNewTaskForm`;
- in `toCreateTaskInput`, replace `category: null,` with `categoryId: s.categoryId,`.

- [ ] **Step 3: Run the form test**

Run: `npm test -w @notreclaim/web -- newTaskForm`
Expected: PASS.

- [ ] **Step 4: Write the failing modal test**

Append to `packages/web/src/app/shell/NewTaskModal.test.tsx` (reuse its existing `renderWithProviders`/`fakeApiClient` imports and the helper that fills the title; mirror the existing create-success test):

```tsx
it('defaults to the default category and submits its id', async () => {
  const createTask = vi.fn().mockResolvedValue({ id: 't1' });
  const api = fakeApiClient({
    getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
    listCategories: vi.fn().mockResolvedValue([
      { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
      { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
    ]),
    createTask,
  } as never);
  renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

  fireEvent.change(await screen.findByPlaceholderText(/task name/i), { target: { value: 'Write' } });
  await waitFor(() => expect(screen.getByTestId('category-select')).toHaveValue('cat-def'));
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-def' })));
});

it('creates a new category and selects it', async () => {
  const createCategory = vi.fn().mockResolvedValue({ id: 'cat-new', userId: 'u', name: 'Deep Work', windows: [], isDefault: false });
  const api = fakeApiClient({
    getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
    listCategories: vi.fn().mockResolvedValue([{ id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]),
    createCategory,
  } as never);
  renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

  fireEvent.click(await screen.findByTestId('new-category-btn'));
  fireEvent.change(screen.getByTestId('new-category-name'), { target: { value: 'Deep Work' } });
  fireEvent.click(screen.getByTestId('new-category-confirm'));
  await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'Deep Work', windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] }));
});
```

(Ensure the test file imports `vi`, `fireEvent`, `screen`, `waitFor` from the libraries it already uses.)

- [ ] **Step 5: Run the modal test to verify it fails**

Run: `npm test -w @notreclaim/web -- NewTaskModal`
Expected: FAIL — `category-select`/`new-category-btn` not found.

- [ ] **Step 6: Implement the modal picker**

In `packages/web/src/app/shell/NewTaskModal.tsx`:

- import the hooks: `import { useCreateTaskMutation, useSettingsQuery, useCategoriesQuery, useCreateCategoryMutation } from '../../api/queries';`
- inside the component, add:

```tsx
  const categoriesQ = useCategoriesQuery();
  const createCategoryM = useCreateCategoryMutation();
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Default the picker to the default category once categories load.
  const categories = categoriesQ.data ?? [];
  useEffect(() => {
    if (form.categoryId === null && categories.length > 0) {
      const def = categories.find((c) => c.isDefault) ?? categories[0]!;
      set('categoryId', def.id);
    }
  }, [categories, form.categoryId]);
```

(add `useEffect` to the `'react'` import.)

- replace the dead "Hours" block (the `<div className="mb-2 rounded-[11px] ...">` containing `Working Hours`) with:

```tsx
        <div className="mb-2 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-inkSoft">Hours</span>
          <div className="flex items-center gap-2">
            <Icons.info size={19} className="mr-1 text-indigo" />
            <select
              data-testid="category-select"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value || null)}
              className="flex-1 bg-transparent text-[18px] font-bold text-ink outline-none"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" data-testid="new-category-btn" onClick={() => setCreatingCat(true)} className="text-[13px] font-bold text-indigo">+ New</button>
          </div>
          {creatingCat && (
            <div className="mt-2 flex items-center gap-2">
              <input data-testid="new-category-name" autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Category name…" className="flex-1 rounded border border-line px-2 py-1 text-[14px] outline-none" />
              <button
                type="button"
                data-testid="new-category-confirm"
                disabled={!newCatName.trim() || createCategoryM.isPending}
                onClick={() => {
                  const windows = settingsQ.data?.workingHours ?? [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
                  createCategoryM.mutate({ name: newCatName.trim(), windows }, {
                    onSuccess: (cat) => { set('categoryId', cat.id); setCreatingCat(false); setNewCatName(''); },
                  });
                }}
                className="rounded bg-indigo px-2.5 py-1 text-[13px] font-bold text-white disabled:opacity-50"
              >Add</button>
            </div>
          )}
        </div>
```

- [ ] **Step 7: Run the modal test**

Run: `npm test -w @notreclaim/web -- NewTaskModal`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/shell
git commit -m "feat(web): functional category picker + create in the New Task modal"
```

---

## Task 7: Web — Edit drawer category picker

**Files:**
- Modify: `packages/web/src/app/tasks/taskForm.ts`
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Modify: `packages/web/src/app/tasks/taskForm.test.ts`
- Modify: `packages/web/src/app/tasks/TaskDrawer.test.tsx`

- [ ] **Step 1: Write the failing form test**

Append to `packages/web/src/app/tasks/taskForm.test.ts` (reuse its existing `toFormState`/`toUpdateInput` imports and a task factory; if none, build a minimal `Task` literal inline):

```ts
it('round-trips categoryId through the edit form', () => {
  const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: 'cat-7', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' } as const;
  const state = toFormState(task as never);
  expect(state.categoryId).toBe('cat-7');
  expect(toUpdateInput(state).categoryId).toBe('cat-7');
});
```

- [ ] **Step 2: Update `taskForm.ts`**

In `packages/web/src/app/tasks/taskForm.ts`:

- change `category: string;     // '' => null` in `TaskFormState` to `categoryId: string | null;`
- in `defaultQuickAddInput`, change `category: null,` to `categoryId: null,`
- in `toFormState`, change `category: t.category ?? '',` to `categoryId: t.categoryId,`
- in `toUpdateInput`, change `category: s.category.trim() || null,` to `categoryId: s.categoryId,`

- [ ] **Step 3: Run the form test**

Run: `npm test -w @notreclaim/web -- tasks/taskForm`
Expected: PASS.

- [ ] **Step 4: Write the failing drawer test**

Append to `packages/web/src/app/tasks/TaskDrawer.test.tsx` (reuse its render helper / task factory):

```tsx
it('renders a category dropdown and saves the chosen categoryId', async () => {
  const onSave = vi.fn();
  const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: 'cat-def', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
  const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([
    { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
    { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
  ]) } as never);
  renderWithProviders(<TaskDrawer task={task as never} onSave={onSave} onCancel={() => {}} />, { api });
  fireEvent.change(await screen.findByTestId('category-select'), { target: { value: 'cat-p' } });
  fireEvent.click(screen.getByTestId('save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-p' })));
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test -w @notreclaim/web -- TaskDrawer`
Expected: FAIL — `category-select` not found (the drawer still renders a free-text input).

- [ ] **Step 6: Implement the drawer dropdown**

In `packages/web/src/app/tasks/TaskDrawer.tsx`:

- add the categories query: `import { useCategoriesQuery } from '../../api/queries';` and inside the component `const categoriesQ = useCategoriesQuery(); const categories = categoriesQ.data ?? [];`
- replace the Category block (the `<div className="mb-2">` containing the free-text `<input ... value={form.category} ...>`) with:

```tsx
      <div className="mb-2">
        <label className={labelCls}>Category</label>
        <select data-testid="category-select" className={ctlCls} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
```

(Because `renderWithProviders` wraps the drawer in `ApiProvider` + `QueryClientProvider`, `useCategoriesQuery` works in the test. The drawer is always rendered inside the app shell which provides both.)

- [ ] **Step 7: Run the drawer test**

Run: `npm test -w @notreclaim/web -- TaskDrawer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/tasks
git commit -m "feat(web): category dropdown in the task edit drawer"
```

---

## Task 8: Web — Settings "Categories" section

**Files:**
- Create: `packages/web/src/app/settings/WeeklyHoursEditor.tsx`
- Modify: `packages/web/src/app/settings/SettingsForm.tsx`
- Create: `packages/web/src/app/settings/categoryForm.ts`
- Create: `packages/web/src/app/settings/CategoriesSection.tsx`
- Modify: `packages/web/src/app/pages/Settings.tsx`
- Create: `packages/web/src/app/settings/categoryForm.test.ts`
- Create: `packages/web/src/app/settings/CategoriesSection.test.tsx`

- [ ] **Step 1: Extract `WeeklyHoursEditor`**

Create `packages/web/src/app/settings/WeeklyHoursEditor.tsx` — the per-weekday rows, lifted verbatim from `SettingsForm` so both can share it:

```tsx
import type { DayState } from './settingsForm';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

export interface WeeklyHoursEditorProps {
  days: DayState[];
  onChange: (weekday: number, patch: Partial<DayState>) => void;
  errors?: Partial<Record<number, string>>;
  idPrefix?: string;
}

export function WeeklyHoursEditor({ days, onChange, errors = {}, idPrefix = 'day' }: WeeklyHoursEditorProps) {
  const ctlCls = 'rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'text-[11px] text-red-600';
  return (
    <div>
      {MON_FIRST.map((wd) => {
        const day = days.find((d) => d.weekday === wd)!;
        const dayErr = errors[wd];
        return (
          <div key={wd} className="flex items-center gap-2 py-1 text-sm">
            <span className={`w-10 ${day.enabled ? 'font-medium' : 'text-gray-400'}`}>{DAY_LABELS[wd]}</span>
            <input type="checkbox" data-testid={`${idPrefix}-${wd}-toggle`} checked={day.enabled} onChange={(e) => onChange(wd, { enabled: e.target.checked })} />
            <input type="time" data-testid={`${idPrefix}-${wd}-start`} className={ctlCls} disabled={!day.enabled} value={day.start} onChange={(e) => onChange(wd, { start: e.target.value })} />
            <span>–</span>
            <input type="time" data-testid={`${idPrefix}-${wd}-end`} className={ctlCls} disabled={!day.enabled} value={day.end} onChange={(e) => onChange(wd, { end: e.target.value })} />
            {dayErr && <span data-testid={`err-${idPrefix}-${wd}`} className={errCls}>{dayErr}</span>}
          </div>
        );
      })}
    </div>
  );
}
```

In `SettingsForm.tsx`, replace the inner `MON_FIRST.map(...)` block of the "Working hours" `<section>` with `<WeeklyHoursEditor days={form.days} onChange={setDay} errors={errors.days} />` and import `WeeklyHoursEditor`. Remove the now-unused `DAY_LABELS`/`MON_FIRST` consts from `SettingsForm.tsx` if they are no longer referenced. Run `npm test -w @notreclaim/web -- Settings` to confirm the existing Settings tests still pass (the `data-testid="day-N-..."` ids are preserved by the default `idPrefix="day"`).

- [ ] **Step 2: Write the failing `categoryForm` test**

Create `packages/web/src/app/settings/categoryForm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { windowsToDays, daysToWindows, validateCategoryForm } from './categoryForm';

describe('categoryForm', () => {
  it('windowsToDays marks listed weekdays enabled and others off', () => {
    const days = windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    expect(days).toHaveLength(7);
    expect(days.find((d) => d.weekday === 1)).toMatchObject({ enabled: true, start: '09:00', end: '17:00' });
    expect(days.find((d) => d.weekday === 2)!.enabled).toBe(false);
  });

  it('daysToWindows emits only enabled days, sorted', () => {
    const days = windowsToDays([{ weekday: 3, startMinute: 600, endMinute: 660 }]);
    expect(daysToWindows(days)).toEqual([{ weekday: 3, startMinute: 600, endMinute: 660 }]);
  });

  it('validation requires a name and at least one valid window', () => {
    expect(validateCategoryForm('', windowsToDays([{ weekday: 1, startMinute: 540, endMinute: 1020 }])).ok).toBe(false);
    const noDays = windowsToDays([]);
    expect(validateCategoryForm('X', noDays).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Implement `categoryForm.ts`**

Create `packages/web/src/app/settings/categoryForm.ts`:

```ts
import type { WorkingHour } from '../../api/types';
import type { DayState } from './settingsForm';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function windowsToDays(windows: WorkingHour[] | null): DayState[] {
  return WEEKDAYS.map((weekday) => {
    const wh = (windows ?? []).find((w) => w.weekday === weekday);
    return wh
      ? { weekday, enabled: true, start: minutesToHHMM(wh.startMinute), end: minutesToHHMM(wh.endMinute) }
      : { weekday, enabled: false, start: '09:00', end: '17:00' };
  });
}

export function daysToWindows(days: DayState[]): WorkingHour[] {
  return days
    .filter((d) => d.enabled)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) }));
}

export function validateCategoryForm(name: string, days: DayState[]): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: 'Name is required' };
  const enabled = days.filter((d) => d.enabled);
  if (enabled.length === 0) return { ok: false, error: 'Enable at least one day' };
  if (enabled.some((d) => hhmmToMinutes(d.start) >= hhmmToMinutes(d.end))) return { ok: false, error: 'End must be after start' };
  return { ok: true };
}
```

- [ ] **Step 4: Run the form test**

Run: `npm test -w @notreclaim/web -- categoryForm`
Expected: PASS.

- [ ] **Step 5: Write the failing section test**

Create `packages/web/src/app/settings/CategoriesSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { CategoriesSection } from './CategoriesSection';

const cats = [
  { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
  { id: 'cat-p', userId: 'u', name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }], isDefault: false },
];

describe('CategoriesSection', () => {
  it('lists categories and disables deleting the default', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    expect(await screen.findByText('Working Hours')).toBeInTheDocument();
    expect(await screen.findByText('Personal')).toBeInTheDocument();
    expect(screen.getByTestId('delete-cat-def')).toBeDisabled();
    expect(screen.getByTestId('delete-cat-p')).not.toBeDisabled();
  });

  it('creates a category from the form', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-n', userId: 'u', name: 'Deep Work', windows: [], isDefault: false });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle')); // enable Monday
    fireEvent.click(screen.getByTestId('save-new-category'));
    await waitFor(() => expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Deep Work' })));
  });
});
```

- [ ] **Step 6: Implement `CategoriesSection.tsx`**

Create `packages/web/src/app/settings/CategoriesSection.tsx`:

```tsx
import { useState } from 'react';
import type { Category, WorkingHour } from '../../api/types';
import { useCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation } from '../../api/queries';
import type { DayState } from './settingsForm';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import { windowsToDays, daysToWindows, validateCategoryForm } from './categoryForm';

function CategoryRow({ category }: { category: Category }) {
  const updateM = useUpdateCategoryMutation();
  const deleteM = useDeleteCategoryMutation();
  const [days, setDays] = useState<DayState[]>(() => windowsToDays(category.windows));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const { ok } = validateCategoryForm(category.name, days);

  return (
    <div className="mb-2 rounded-lg border border-gray-200 p-3" data-testid={`cat-row-${category.id}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{category.name}{category.isDefault && ' (default)'}</span>
        <button
          data-testid={`delete-${category.id}`}
          disabled={category.isDefault || deleteM.isPending}
          onClick={() => deleteM.mutate(category.id)}
          className="text-[12px] text-red-600 disabled:opacity-40"
        >Delete</button>
      </div>
      {category.isDefault ? (
        <p className="text-[12px] text-gray-400">Uses your working hours above.</p>
      ) : (
        <>
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix={`cat-${category.id}`} />
          <button
            data-testid={`save-${category.id}`}
            disabled={!ok || updateM.isPending}
            onClick={() => updateM.mutate({ id: category.id, patch: { windows: daysToWindows(days) } })}
            className="mt-1 rounded bg-blue-600 px-3 py-1 text-[12px] text-white disabled:opacity-50"
          >Save hours</button>
        </>
      )}
    </div>
  );
}

export function CategoriesSection() {
  const categoriesQ = useCategoriesQuery();
  const createM = useCreateCategoryMutation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState<DayState[]>(() => windowsToDays([]));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const { ok } = validateCategoryForm(name, days);

  const submit = () => {
    const windows: WorkingHour[] = daysToWindows(days);
    createM.mutate({ name: name.trim(), windows }, {
      onSuccess: () => { setAdding(false); setName(''); setDays(windowsToDays([])); },
    });
  };

  return (
    <section className="mb-4 max-w-md rounded-lg border border-gray-200 p-3" data-testid="categories-section">
      <h3 className="mb-2 text-sm font-semibold">Categories</h3>
      {(categoriesQ.data ?? []).map((c) => <CategoryRow key={c.id} category={c} />)}

      {adding ? (
        <div className="rounded-lg border border-gray-200 p-3">
          <input data-testid="cat-name-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name…" className="mb-1 w-full rounded border border-gray-300 px-2 py-0.5 text-sm" />
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix="newcat" />
          <div className="mt-1 flex gap-2">
            <button data-testid="save-new-category" disabled={!ok || createM.isPending} onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-[12px] text-white disabled:opacity-50">Create</button>
            <button onClick={() => setAdding(false)} className="rounded border border-gray-300 px-3 py-1 text-[12px]">Cancel</button>
          </div>
        </div>
      ) : (
        <button data-testid="add-category" onClick={() => setAdding(true)} className="text-[13px] font-bold text-blue-600">+ Add category</button>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Mount it on the Settings page**

In `packages/web/src/app/pages/Settings.tsx`, import `CategoriesSection` and render it directly below `<SettingsForm .../>`. Wrap the two in a fragment:

```tsx
import { CategoriesSection } from '../settings/CategoriesSection';
```

```tsx
  return (
    <>
      <SettingsForm
        initial={initial}
        saving={updateM.isPending}
        justSaved={updateM.isSuccess}
        error={updateM.error instanceof ApiError ? updateM.error : null}
        onSave={(input) => updateM.mutate(input)}
      />
      <CategoriesSection />
    </>
  );
```

- [ ] **Step 8: Run the tests**

Run: `npm test -w @notreclaim/web -- "settings"`
Expected: PASS (categoryForm, CategoriesSection, and the existing SettingsForm/Settings tests).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/app/settings packages/web/src/app/pages/Settings.tsx
git commit -m "feat(web): Categories section on Settings (create/delete + per-category hours)"
```

---

## Task 9: Verification

**Files:** none (verification only).

- [ ] **Step 1: Full web suite + build**

Run: `npm test -w @notreclaim/web` then `npm run build -w @notreclaim/web`
Expected: all web tests pass; `tsc` clean + `vite build` succeeds.

- [ ] **Step 2: Full monorepo suite (Postgres up)**

Confirm Postgres is accepting connections (`pg_isready -h /tmp -p 5432`), then run each package:

```bash
for p in scheduler core db google server web; do echo "== $p =="; npm test -w @notreclaim/$p 2>&1 | grep -E "Test Files|Tests "; done
```

Expected: every package green (scheduler/core/db/server gained tests; google unchanged).

- [ ] **Step 3: Whole-branch review**

Dispatch a final whole-branch reviewer over `git diff main...feat/task-categories` (architecture coherence: picker → categoryId → PATCH/POST → reflow → assemble union envelope + per-task allowedWindows → engine confinement; conventions; no leftover `category` free-text references; migration correctness; test quality). Address any Critical/Important findings, then proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

- **Spec goals → tasks:** Category entity + windows (T1) ✓; default "Working Hours" inheriting Settings via `windows=null` (T1 `ensureDefault`, T3 fallback) ✓; modal picker + "+ New category" (T6) ✓; edit drawer picker (T7) ✓; Settings "Categories" section with per-category window editor (T8) ✓; engine confinement + union envelope (T2, T3) ✓; reflow on category/window change (T4 `afterMutation`) ✓.
- **Non-goals respected:** no `color` field; no Settings working-hours rework (default inherits); no habit changes; no per-category priority.
- **Type consistency:** `categoryId` used end-to-end (db `CreateTaskInput`/`UpdateTaskInput`, server schema, web `Task`/`CreateTaskInput`, `newTaskForm`/`taskForm`); `Category.windows` is `WorkingHour[] | null` (web) / `Json?` (db) / expanded via `category.windows ?? settings.workingHours` (core); `FlexibleTask.allowedWindows?: Interval[]` (engine) set by assemble.
- **Deviation from spec note:** the spec mentioned a *migration-time* default-category backfill; this plan instead provisions the default lazily via `ensureDefault` (called by `GET /categories`) and resolves null/unknown `categoryId` to `settings.workingHours` in `assemble`. This is more robust (no hand-edited migration SQL, works for users who never had a default row) and satisfies the same user-visible behavior. The migration is pure schema (add `Category`, add `Task.categoryId`, drop `Task.category`).
