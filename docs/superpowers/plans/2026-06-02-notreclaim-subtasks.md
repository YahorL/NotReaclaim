# Task Subtasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight subtask checklist to each task — create / check / delete subtasks in the edit drawer, with a done/total badge on the Priorities board card.

**Architecture:** A first-class `Subtask` table (`title` + `done`, cascade-deleted with the task). `TaskRepository.listByUser`/`findById` `include` subtasks so one `/tasks` query feeds the board badge and the drawer. A `SubtaskRepository` + flat CRUD routes (`/subtasks`, no re-plan). Web gets a `Subtask` DTO, optional `Task.subtasks?`, hooks invalidating `tasksRoot` only, a drawer section, and a card badge. The scheduler is untouched and stays decoupled from the include.

**Tech Stack:** TypeScript ESM (strict, `noUncheckedIndexedAccess`); Prisma + Postgres; Fastify; React + Vite + Tailwind v3 + TanStack Query; vitest + @testing-library/react@16 + jsdom.

**Conventions (every task):** Backend explicit `.js` imports; `packages/web` EXTENSIONLESS imports + NEVER `import React`. Tailwind v3 literal classes. Per-package test: `npm test -w @notreclaim/<pkg>`. Web tests pin `TZ=UTC`; web build = `tsc -p tsconfig.json && vite build`. `@notreclaim/db` tests need userspace Postgres (`/tmp:5432`). Do NOT commit `seed-dev.mjs` / `.env.run` / `.env.test` / `design_handoff_notreclaim/` / `review/` / `.claude/`.

**Sequencing note:** Task 1 widens `TaskRepository.listByUser`/`findById` to `TaskWithSubtasks` and (same task) decouples core's `SchedulingRepositories.tasks` to base `Task[]` so core needs no fake change — Task 1's gate is **db + core** green. The widened `TaskRepository` ripples to the **server** fake (Task 2 adds `subtasks: []` to `fakeTaskRepo.make`) and to **web** only via the optional DTO field (no fixture sweep). Per-task gate is that task's own package(s); Task 6 runs the full monorepo.

**Branch:** `feat/subtasks` (spec committed at `2ea7c2a`).

---

## File Structure

- `packages/db/prisma/schema.prisma` + migration — `Subtask` model + `Task.subtasks`.
- `packages/db/src/repositories/task-repository.ts` — include subtasks; `TaskWithSubtasks`.
- `packages/db/src/repositories/subtask-repository.ts` — **new** `SubtaskRepository`.
- `packages/db/src/index.ts` — exports. `packages/db/test/setup-each.ts` — TRUNCATE.
- `packages/core/src/assemble.ts` — decouple `SchedulingRepositories.tasks`.
- `packages/server/src/schemas.ts`, `subtask-routes.ts` (**new**), `app.ts`, `server.ts`.
- `packages/server/test/fakes.ts` — `fakeSubtaskRepo` + `fakeTaskRepo.make` `subtasks:[]`.
- `packages/web/src/api/{types,client,queries}.ts`, `test/fakes.tsx`.
- `packages/web/src/app/tasks/TaskDrawer.tsx`, `app/pages/Priorities.tsx`, `app/priorities/TaskRow.tsx`.

---

## Task 1: DB — `Subtask` model, repository, task include

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/repositories/subtask-repository.ts`
- Modify: `packages/db/src/repositories/task-repository.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/test/setup-each.ts`
- Modify: `packages/core/src/assemble.ts`
- Create: `packages/db/test/repositories/subtask-repository.test.ts`

- [ ] **Step 1: Schema**

In `model Task`, add to the relations area (next to `scheduledBlocks`/`category`):
```prisma
  subtasks        Subtask[]
```
Add the model after `model Task { ... }`:
```prisma
model Subtask {
  id        String   @id @default(uuid())
  taskId    String
  title     String
  done      Boolean  @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Migration**

```bash
cd packages/db
set -a; . ./.env.test; set +a
export DATABASE_URL="$TEST_DATABASE_URL"
export SHADOW_DATABASE_URL="${SHADOW_DATABASE_URL:-${TEST_DATABASE_URL%/*}/notreclaim_shadow}"
npx prisma migrate dev --name subtasks
```
Expected: `prisma/migrations/<timestamp>_subtasks/migration.sql` creating the `Subtask` table + FK, applied, client regenerated.
**Fallback (proven in C/D/E) if the shadow DB can't be used:** author `prisma/migrations/20260602000000_subtasks/migration.sql`:
```sql
CREATE TABLE "Subtask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
then `psql "$TEST_DATABASE_URL" -f prisma/migrations/20260602000000_subtasks/migration.sql`, `DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate resolve --applied 20260602000000_subtasks`, `npx prisma generate`. Committed SQL must be valid forward DDL replayable by `migrate deploy`.

- [ ] **Step 3: Add `Subtask` to the test TRUNCATE list**

In `packages/db/test/setup-each.ts`, add `'Subtask',` to the `TABLES` array (place it FIRST, before `'ScheduledBlock'` — it's a child of `Task`; CASCADE handles order, but listing children first is the existing convention).

- [ ] **Step 4: Write the failing repository test**

Create `packages/db/test/repositories/subtask-repository.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { NotFoundError } from '../../src/errors.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { createSubtaskRepository } from '../../src/repositories/subtask-repository.js';

const users = createUserRepository(prisma);
const tasks = createTaskRepository(prisma);
const repo = createSubtaskRepository(prisma);

const taskInput = () => ({ title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1 });

describe('SubtaskRepository', () => {
  it('creates subtasks under a task and lists them with the task in creation order', async () => {
    const user = await users.create({ email: 'st1@example.com' });
    const task = await tasks.create(user.id, taskInput());
    await repo.create(user.id, task.id, { title: 'first' });
    await repo.create(user.id, task.id, { title: 'second' });
    const fetched = await tasks.findById(user.id, task.id);
    expect(fetched!.subtasks.map((s) => s.title)).toEqual(['first', 'second']);
    expect(fetched!.subtasks.every((s) => s.done === false)).toBe(true);
  });

  it('toggles done and renames; rejects unknown id', async () => {
    const user = await users.create({ email: 'st2@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const s = await repo.create(user.id, task.id, { title: 'a' });
    const done = await repo.update(user.id, s.id, { done: true, title: 'a2' });
    expect(done).toMatchObject({ done: true, title: 'a2' });
    await expect(repo.update(user.id, 'missing', { done: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('enforces ownership and cascades on task delete', async () => {
    const owner = await users.create({ email: 'st3@example.com' });
    const other = await users.create({ email: 'st4@example.com' });
    const task = await tasks.create(owner.id, taskInput());
    const s = await repo.create(owner.id, task.id, { title: 'x' });
    await expect(repo.create(other.id, task.id, { title: 'y' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.update(other.id, s.id, { done: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.delete(other.id, s.id)).rejects.toBeInstanceOf(NotFoundError);
    await tasks.delete(owner.id, task.id);
    expect(await prisma.subtask.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test -w @notreclaim/db -- subtask-repository`
Expected: FAIL — `createSubtaskRepository` undefined / `fetched.subtasks` not present.

- [ ] **Step 6: Implement the repository**

Create `packages/db/src/repositories/subtask-repository.ts`:
```ts
import type { PrismaClient, Subtask } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export interface CreateSubtaskInput {
  title: string;
}
export interface UpdateSubtaskInput {
  title?: string;
  done?: boolean;
}

export function createSubtaskRepository(prisma: PrismaClient) {
  return {
    async create(userId: string, taskId: string, data: CreateSubtaskInput): Promise<Subtask> {
      const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
      if (!task) throw new NotFoundError(`Task ${taskId} not found for user`);
      try {
        return await prisma.subtask.create({ data: { taskId, title: data.title } });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    async update(userId: string, id: string, data: UpdateSubtaskInput): Promise<Subtask> {
      try {
        const result = await prisma.subtask.updateMany({ where: { id, task: { userId } }, data });
        if (result.count === 0) throw new NotFoundError(`Subtask ${id} not found for user`);
        return await prisma.subtask.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const result = await prisma.subtask.deleteMany({ where: { id, task: { userId } } });
      if (result.count === 0) throw new NotFoundError(`Subtask ${id} not found for user`);
    },
  };
}

export type SubtaskRepository = ReturnType<typeof createSubtaskRepository>;
```

- [ ] **Step 7: Include subtasks on the task repo**

In `packages/db/src/repositories/task-repository.ts`:
- change the type import to add `Prisma`: `import type { Prisma, PrismaClient, Task, TaskStatus } from '@prisma/client';`
- add after the imports: `export type TaskWithSubtasks = Prisma.TaskGetPayload<{ include: { subtasks: true } }>;`
- `listByUser` return type → `Promise<TaskWithSubtasks[]>` and add the include:
  ```ts
    listByUser(userId: string, opts: { status?: TaskStatus } = {}): Promise<TaskWithSubtasks[]> {
      return prisma.task.findMany({
        where: { userId, ...(opts.status ? { status: opts.status } : {}) },
        orderBy: [{ priority: 'asc' }, { dueBy: 'asc' }],
        include: { subtasks: { orderBy: { createdAt: 'asc' } } },
      });
    },
  ```
- `findById` return type → `Promise<TaskWithSubtasks | null>` and add the include:
  ```ts
    findById(userId: string, id: string): Promise<TaskWithSubtasks | null> {
      return prisma.task.findFirst({ where: { id, userId }, include: { subtasks: { orderBy: { createdAt: 'asc' } } } });
    },
  ```
(Leave `create`/`update`/`delete` returning base `Task` — they don't need subtasks.)

- [ ] **Step 8: db index exports**

In `packages/db/src/index.ts`, add after the task-repository exports:
```ts
export { createSubtaskRepository } from './repositories/subtask-repository.js';
export type { SubtaskRepository, CreateSubtaskInput, UpdateSubtaskInput } from './repositories/subtask-repository.js';
export type { TaskWithSubtasks } from './repositories/task-repository.js';
```
and add `Subtask,` to the `export type { User, Settings, ... } from '@prisma/client';` block.

- [ ] **Step 9: Decouple core's scheduling task interface**

In `packages/core/src/assemble.ts`, add `Task` to the `@notreclaim/db` type import (it already imports `TaskStatus`):
```ts
import type {
  SettingsRepository,
  CalendarEventRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
  CategoryRepository,
  TaskStatus,
  Task,
} from '@notreclaim/db';
```
and change the `tasks` line in `interface SchedulingRepositories` from `tasks: Pick<TaskRepository, 'listByUser'>;` to:
```ts
  tasks: { listByUser(userId: string, opts?: { status?: TaskStatus }): Promise<Task[]> };
```
(The real `TaskRepository.listByUser` now returns `TaskWithSubtasks[]`, which is assignable to `Promise<Task[]>`; the core fake returning base `Task[]` is unaffected. `toFlexibleTask` is unchanged.) If `TaskRepository` is now unused in the import, leave it — it may still be referenced elsewhere in the file; remove only if the compiler flags it unused.

- [ ] **Step 10: Run db + core tests**

Run: `npm test -w @notreclaim/db` then `npm test -w @notreclaim/core` then `npm run build -w @notreclaim/core`
Expected: all PASS, core build clean (the decouple keeps core green with no fake change).

- [ ] **Step 11: Commit**

```bash
git add packages/db packages/core
git commit -m "feat(db): Subtask model + repository; task include; decouple core task interface"
```

---

## Task 2: Server — subtask routes + wiring

**Files:**
- Modify: `packages/server/src/schemas.ts`, `app.ts`, `server.ts`
- Create: `packages/server/src/subtask-routes.ts`
- Modify: `packages/server/test/fakes.ts`
- Create: `packages/server/test/subtask-routes.test.ts`

- [ ] **Step 1: Extend fakes + write failing tests**

In `packages/server/test/fakes.ts`:
- add `Subtask` to the db type import (`import type { Settings, Task, Habit, ScheduledBlock, CalendarEvent, User, Category, Subtask } from '@notreclaim/db';`);
- add `subtasks: [],` to `fakeTaskRepo`'s `make` object (so it conforms to the widened `TaskRepository` whose `listByUser`/`findById` now return tasks with `subtasks`);
- add the fake repo (it needs the task repo to check ownership):
```ts
export function fakeSubtaskRepo(seed: Subtask[] = [], taskRepo: { findById(userId: string, id: string): Promise<Task | null> }) {
  let rows = [...seed];
  let n = seed.length;
  const make = (taskId: string, data: Record<string, unknown>): Subtask => ({
    id: `sub-${++n}`, taskId, title: '', done: false, createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Subtask;
  const owned = async (userId: string, id: string): Promise<Subtask | null> => {
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return (await taskRepo.findById(userId, row.taskId)) ? row : null;
  };
  return {
    async create(userId: string, taskId: string, data: Record<string, unknown>): Promise<Subtask> {
      if (!(await taskRepo.findById(userId, taskId))) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${taskId}`); }
      const row = make(taskId, data); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Subtask> {
      const row = await owned(userId, id);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Subtask ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = await owned(userId, id);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Subtask ${id}`); }
      rows = rows.filter((r) => r.id !== id);
    },
  };
}
```
- in `TestAppOptions`, add `subtasks?: Subtask[];`
- in `buildTestApp`, add `const subtasks = fakeSubtaskRepo(opts.subtasks ?? [], tasks);` (AFTER `const tasks = ...`), include `subtasks` in the `repos` object passed to `buildApp`, and return `subtasks` from `buildTestApp`.

Then create `packages/server/test/subtask-routes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';
import type { Task } from '@notreclaim/db';

const seededTask = { id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1, categoryId: null, notBefore: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [] } as unknown as Task;

describe('subtask routes', () => {
  it('creates a subtask under the user\'s task', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/subtasks', headers: { authorization: `Bearer ${token}` }, payload: { taskId: 't1', title: 'step 1' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ taskId: 't1', title: 'step 1', done: false });
  });

  it('patches and deletes a subtask', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1', title: 's' } });
    const id = (created.json() as { id: string }).id;
    const patched = await app.inject({ method: 'PATCH', url: `/subtasks/${id}`, headers: auth, payload: { done: true } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ done: true });
    const del = await app.inject({ method: 'DELETE', url: `/subtasks/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('rejects a bad body (400) and a subtask under another user\'s task (404)', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const bad = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1' } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 'nope', title: 'x' } });
    expect(missing.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/server -- subtask-routes`
Expected: FAIL — `/subtasks` routes 404 (not registered).

- [ ] **Step 3: Add schemas**

In `packages/server/src/schemas.ts`, add (after the category schemas):
```ts
export const createSubtaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
});
export const updateSubtaskSchema = z.object({
  title: z.string().min(1).optional(),
  done: z.boolean().optional(),
}).refine((b) => b.title !== undefined || b.done !== undefined, { message: 'title or done is required' });
```

- [ ] **Step 4: Create the routes**

Create `packages/server/src/subtask-routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { idParamSchema, createSubtaskSchema, updateSubtaskSchema } from './schemas.js';

export function registerSubtaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/subtasks', guard, async (request, reply) => {
    const body = createSubtaskSchema.parse(request.body);
    const subtask = await deps.repos.subtasks.create(request.userId, body.taskId, { title: body.title });
    reply.code(201);
    return subtask;
  });

  app.patch('/subtasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSubtaskSchema.parse(request.body);
    return deps.repos.subtasks.update(request.userId, id, body);
  });

  app.delete('/subtasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.subtasks.delete(request.userId, id);
    reply.code(204).send();
  });
}
```
(No `afterMutation` — subtasks don't change scheduling.)

- [ ] **Step 5: Wire `AppDeps` + registration in `app.ts`**

In `packages/server/src/app.ts`:
- add `SubtaskRepository` to the `@notreclaim/db` type import;
- add to `AppDeps.repos`: `subtasks: SubtaskRepository;`
- import `import { registerSubtaskRoutes } from './subtask-routes.js';`
- register after `registerCategoryRoutes(...)`: `registerSubtaskRoutes(app, deps);`

- [ ] **Step 6: Wire the real repo in `server.ts`**

In `packages/server/src/server.ts`:
- add `createSubtaskRepository` to the `@notreclaim/db` import;
- after `const categories = createCategoryRepository(prisma);`: `const subtasks = createSubtaskRepository(prisma);`
- add `subtasks` to `repos` in the `buildApp({ repos: { ... } })` call (NOT to `schedulingRepos` — subtasks aren't a scheduling input).

- [ ] **Step 7: Run the tests**

Run: `npm test -w @notreclaim/server`
Expected: PASS (all server tests incl. the 3 new ones; existing tests pass with the `subtasks: []` fake addition).

- [ ] **Step 8: Commit**

```bash
git add packages/server
git commit -m "feat(server): subtask CRUD routes + wiring"
```

---

## Task 3: Web API — Subtask DTO, client, hooks

**Files:**
- Modify: `packages/web/src/api/types.ts`, `client.ts`, `queries.ts`, `test/fakes.tsx`
- Create: `packages/web/src/api/subtasks.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/api/subtasks.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { useCreateSubtaskMutation } from './queries';

describe('subtask queries', () => {
  it('useCreateSubtaskMutation calls createSubtask and invalidates tasks', async () => {
    const createSubtask = vi.fn().mockResolvedValue({ id: 's1', taskId: 't1', title: 'a', done: false });
    const api = fakeApiClient({ createSubtask } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><ApiProvider client={api}>{children}</ApiProvider></QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateSubtaskMutation(), { wrapper });
    result.current.mutate({ taskId: 't1', title: 'a' });
    await waitFor(() => expect(createSubtask).toHaveBeenCalledWith({ taskId: 't1', title: 'a' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @notreclaim/web -- subtasks.test`
Expected: FAIL — `useCreateSubtaskMutation`/`createSubtask` not defined.

- [ ] **Step 3: DTOs (`api/types.ts`)**

Add (after the `Task` interface or near it):
```ts
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
}
export interface CreateSubtaskInput { taskId: string; title: string }
export interface UpdateSubtaskInput { title?: string; done?: boolean }
```
and add to `interface Task` (after `timeLoggedMs` or near the end): `subtasks?: Subtask[];` (**optional** — no fixture sweep).

- [ ] **Step 4: Client methods (`api/client.ts`)**

- add `Subtask, CreateSubtaskInput, UpdateSubtaskInput` to the type import from `./types`;
- add to the `ApiClient` interface:
```ts
  createSubtask(body: CreateSubtaskInput): Promise<Subtask>;
  updateSubtask(id: string, patch: UpdateSubtaskInput): Promise<Subtask>;
  deleteSubtask(id: string): Promise<void>;
```
- add to the returned object in `createApiClient`:
```ts
    createSubtask: (body) => request('POST', '/subtasks', body),
    updateSubtask: (id, patch) => request('PATCH', `/subtasks/${id}`, patch),
    deleteSubtask: (id) => request('DELETE', `/subtasks/${id}`),
```

- [ ] **Step 5: Fake base entries (`test/fakes.tsx`)**

Add to the `base` object in `fakeApiClient`:
```ts
    createSubtask: notImplemented('createSubtask'),
    updateSubtask: notImplemented('updateSubtask'),
    deleteSubtask: notImplemented('deleteSubtask'),
```

- [ ] **Step 6: Hooks (`api/queries.ts`)**

- add `CreateSubtaskInput, UpdateSubtaskInput` to the `import type { ... } from './types';`
- append (note: invalidate `tasksRoot` ONLY — subtasks don't reschedule):
```ts
function invalidateTasksOnly(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
}

export function useCreateSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateSubtaskInput) => api.createSubtask(body), onSuccess: () => invalidateTasksOnly(qc) });
}
export function useUpdateSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateSubtaskInput }) => api.updateSubtask(id, patch), onSuccess: () => invalidateTasksOnly(qc) });
}
export function useDeleteSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteSubtask(id), onSuccess: () => invalidateTasksOnly(qc) });
}
```

- [ ] **Step 7: Run the test**

Run: `npm test -w @notreclaim/web -- subtasks.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api packages/web/src/test/fakes.tsx
git commit -m "feat(web): Subtask DTOs, client methods, and mutation hooks"
```

---

## Task 4: Web — TaskDrawer subtasks section + live editing

**Files:**
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Modify: `packages/web/src/app/pages/Priorities.tsx`
- Modify: `packages/web/src/app/tasks/TaskDrawer.test.tsx`

- [ ] **Step 1: Write the failing drawer test**

Append to `packages/web/src/app/tasks/TaskDrawer.test.tsx` (reuse its `renderWithProviders`/`fakeApiClient`/`task()` helper, `vi`/`fireEvent`/`screen`/`waitFor`):
```tsx
it('lists subtasks, adds, toggles, and deletes them', async () => {
  const createSubtask = vi.fn().mockResolvedValue({ id: 's2', taskId: 't', title: 'new', done: false });
  const updateSubtask = vi.fn().mockResolvedValue({ id: 's1', taskId: 't', title: 'a', done: true });
  const deleteSubtask = vi.fn().mockResolvedValue(undefined);
  const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]), createSubtask, updateSubtask, deleteSubtask } as never);
  const t = task({ id: 't', subtasks: [{ id: 's1', taskId: 't', title: 'a', done: false }] });
  renderWithProviders(<TaskDrawer task={t as never} onSave={() => {}} onCancel={() => {}} />, { api });

  expect(await screen.findByText('a')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('subtask-toggle-s1'));
  await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { done: true }));
  fireEvent.click(screen.getByTestId('subtask-delete-s1'));
  await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith('s1'));
  fireEvent.change(screen.getByTestId('subtask-input'), { target: { value: 'new' } });
  fireEvent.click(screen.getByTestId('subtask-add'));
  await waitFor(() => expect(createSubtask).toHaveBeenCalledWith({ taskId: 't', title: 'new' }));
});
```
(If the file's `task()` factory doesn't accept `subtasks`, build a literal with `subtasks: [...]` matching the existing dropdown test's task shape.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/web -- TaskDrawer`
Expected: FAIL — `subtask-*` testids not found.

- [ ] **Step 3: Add the Subtasks section to `TaskDrawer.tsx`**

- add to the queries import: `import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';`
- add `useState` for the new-subtask input (the file already imports `useState`): inside the component add:
```tsx
  const createSubtaskM = useCreateSubtaskMutation();
  const updateSubtaskM = useUpdateSubtaskMutation();
  const deleteSubtaskM = useDeleteSubtaskMutation();
  const [newSubtask, setNewSubtask] = useState('');
  const subtasks = task.subtasks ?? [];
```
- render a Subtasks section (place it after the Category `<div>`, before the Status `<div>`):
```tsx
      <div className="mb-2">
        <label className={labelCls}>Subtasks</label>
        <ul className="mb-1 space-y-1">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-testid={`subtask-toggle-${s.id}`} checked={s.done} onChange={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })} />
              <span className={`flex-1 ${s.done ? 'text-gray-400 line-through' : ''}`}>{s.title}</span>
              <button type="button" data-testid={`subtask-delete-${s.id}`} aria-label="delete subtask" onClick={() => deleteSubtaskM.mutate(s.id)} className="text-[12px] text-red-600">×</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <input data-testid="subtask-input" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask…" className={`${ctlCls} flex-1`} />
          <button type="button" data-testid="subtask-add" disabled={!newSubtask.trim() || createSubtaskM.isPending}
            onClick={() => createSubtaskM.mutate({ taskId: task.id, title: newSubtask.trim() }, { onSuccess: () => setNewSubtask('') })}
            className="rounded bg-blue-600 px-2 text-[12px] text-white disabled:opacity-50">Add</button>
        </div>
      </div>
```
(`labelCls`/`ctlCls` already exist. Subtasks come from the live `task` prop, not local form state.)

- [ ] **Step 4: Make the open drawer re-derive from the tasks query (`Priorities.tsx`)**

- change the editing state from a task object to an id:
  ```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  ```
- derive the open task fresh from the query (so subtask mutations refetch into the drawer):
  ```tsx
  const editing = (tasksQ.data ?? []).find((t) => t.id === editingId) ?? null;
  ```
- update the references: `onDelete` → `onSuccess: () => { if (editingId === t.id) setEditingId(null); }`; the `<Board ... onEdit={(t) => setEditingId(t.id)} ... />`; and the drawer block:
  ```tsx
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
  ```
  (Remove the old `editing`/`setEditing` `useState`. `editing` is now the derived const.)

- [ ] **Step 5: Run the drawer test + the Priorities test**

Run: `npm test -w @notreclaim/web -- TaskDrawer` then `npm test -w @notreclaim/web -- Priorities`
Expected: PASS (the editing-by-id change is transparent to the existing Priorities tests, which open/close the drawer by interaction).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/pages/Priorities.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx
git commit -m "feat(web): subtasks section in the task drawer (live via editing-by-id)"
```

---

## Task 5: Web — board card subtask badge

**Files:**
- Modify: `packages/web/src/app/priorities/TaskRow.tsx`
- Modify: `packages/web/src/app/priorities/TaskRow.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/app/priorities/TaskRow.test.tsx` (if the file doesn't exist, create it; render `<TaskRow>` with the minimal props it needs — see its `TaskRowProps`: `task, bucket, nextMs, now, dragging, onComplete, onEdit, onDelete, onDragStart, onDragEnd`):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task) {
  return render(<TaskRow task={task} bucket="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false} onComplete={noop} onEdit={noop} onDelete={noop} onDragStart={noop} onDragEnd={noop} />);
}

describe('TaskRow subtask badge', () => {
  it('shows done/total when the task has subtasks', () => {
    renderRow({ ...base, subtasks: [{ id: 's1', taskId: 't', title: 'a', done: true }, { id: 's2', taskId: 't', title: 'b', done: false }] } as Task);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
  });
  it('shows no badge when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/web -- TaskRow`
Expected: FAIL — `subtask-count` not found.

- [ ] **Step 3: Add the badge to `TaskRow.tsx`**

Inside the component, after `const done = ...`, add:
```tsx
  const subtasks = task.subtasks ?? [];
  const subtaskDone = subtasks.filter((s) => s.done).length;
```
and in the meta line `<div className="mt-1 flex items-center gap-1.5 ...">` (which contains the calendar icon + `{meta}`), append after the `<span>{meta}</span>`:
```tsx
          {subtasks.length > 0 && (
            <span data-testid="subtask-count" className="flex items-center gap-1 text-inkSoft">
              <Icons.check size={13} />{subtaskDone}/{subtasks.length}
            </span>
          )}
```
(`Icons` is already imported. The badge sits in the existing meta row.)

- [ ] **Step 4: Run the test**

Run: `npm test -w @notreclaim/web -- TaskRow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx
git commit -m "feat(web): subtask done/total badge on the board card"
```

---

## Task 6: Verification

**Files:** none.

- [ ] **Step 1: Full web suite + build**

Run: `npm test -w @notreclaim/web` then `npm run build -w @notreclaim/web` → all pass, clean.

- [ ] **Step 2: Full monorepo (Postgres up)**

```bash
pg_isready -h /tmp -p 5432
for p in scheduler core db google server web; do echo "== $p =="; npm test -w @notreclaim/$p 2>&1 | grep -E "Test Files|Tests "; done
```
Expected: every package green (scheduler/google unchanged; core/db/server/web gained tests or changes).

- [ ] **Step 3: Whole-branch review**

Dispatch a final reviewer over `git diff main...feat/subtasks` (data flow: drawer add/toggle/delete → `/subtasks` → `SubtaskRepository` → tasks include → `tasksRoot` invalidation → drawer + card update; no re-plan; ownership scoping; conventions; the `TaskWithSubtasks` widening + core decouple; backward-compat) and proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

- **Spec goals → tasks:** `Subtask` table + cascade (T1) ✓; create/rename/toggle/delete in drawer (T4) ✓; done/total badge (T5) ✓; subtasks on the Task via include (T1) ✓; `tasksRoot`-only invalidation (T3) ✓; no scheduler impact (no `afterMutation`, T2; core decoupled, T1) ✓.
- **Non-goals respected:** no scheduling/duration; no parent auto-complete; no reordering/nesting; subtask routes don't re-plan.
- **Type consistency:** `Subtask {id, taskId, title, done}` end-to-end (db Prisma, server zod `{taskId,title}`/`{title?,done?}`, web DTO); repo methods `create(userId, taskId, {title})` / `update(userId, id, {title?,done?})` / `delete(userId, id)`; `TaskWithSubtasks` from `listByUser`/`findById`; web `Task.subtasks?` optional; hooks invalidate `tasksRoot`.
- **Deliberate choices:** core's `SchedulingRepositories.tasks` decoupled to base `Task[]` (no core fake change); server `fakeTaskRepo.make` gains `subtasks: []` (conforms to widened repo); web DTO field optional (no fixture sweep). Migration is additive (new table) — replays via `migrate deploy`.
