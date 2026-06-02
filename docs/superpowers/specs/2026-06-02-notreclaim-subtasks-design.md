# NotReclaim — Task Subtasks (Review 1, Milestone F1) — Design Spec

**Date:** 2026-06-02
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` item #5 (first half) — *"In priorities tab for task I need an ability to
create subtasks."* (The second half — within-column ordering — is **Milestone F2**, a separate
sub-milestone.)
**Builds on:** the Task model, the edit drawer (`TaskDrawer`), and the Priorities board card (`TaskRow`).

## Summary

Add a lightweight **subtask checklist** to each task: a first-class `Subtask` entity (`title` + `done`),
created/checked/deleted in the **edit drawer**, with a **`done/total` badge** on the Priorities board
card. Subtasks ride along on the Task via a Prisma `include` (one query powers both the board counts and
the drawer). Subtasks are **organizational only** — they are not scheduled, have no duration, and do not
affect the engine.

## Goals

- A `Subtask { id, taskId, title, done }` per task (cascade-deleted with the task), ordered by creation.
- Create / rename / toggle-done / delete subtasks from the task's edit drawer; edits reflect live.
- A `done/total` count badge on the board card when a task has subtasks.
- Subtasks included on the Task DTO so the board + drawer share one tasks query.
- Deterministic tests at every layer; no scheduler impact.

## Non-Goals

- **No scheduling effect** — subtasks have no duration and are never placed by the engine; the parent
  task still schedules as one unit by its own `durationMs`.
- **No auto-complete of the parent** when all subtasks are done (subtask state is independent of
  `Task.status`).
- **No subtask reordering** (creation order only; within-column *task* ordering is Milestone F2).
- No nesting (subtasks of subtasks), no per-subtask due dates/assignees.
- Subtask mutations do **not** trigger a re-plan (no `afterMutation`).

## Decisions (locked during brainstorming)

- **First-class `Subtask` table** (not a JSON array on `Task`) — per-subtask atomic toggle, matches the
  `Category` precedent. (Rejected the JSON-array approach: read-modify-write the whole array to toggle one
  item, race-prone.)
- **Subtasks included on the Task** via `TaskRepository.listByUser`/`findById` `include` — one `/tasks`
  query gives the board its counts and the drawer its list. The scheduler's task query is the same method
  and simply ignores `subtasks`.
- **Web `Task.subtasks?: Subtask[]` is optional** (read `?? []`) so existing Task fixtures need no sweep;
  the server always returns the array (possibly empty).
- **Flat routes** `POST /subtasks` / `PATCH /subtasks/:id` / `DELETE /subtasks/:id` (mirror `/categories`),
  with ownership scoped through the `task: { userId }` relation. No `afterMutation`.
- **Drawer reflects edits live** by having the Priorities page store the **editing task id** and re-derive
  the open task from the tasks query (a subtask mutation → `tasksRoot` invalidation → fresh `subtasks` on
  the prop). The drawer's other fields remain local form state (initialized once).

## Architecture / Components

### Data model — `@notreclaim/db`
- New model:
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
  `Task` gains `subtasks Subtask[]`. Additive Prisma migration (creates the table; no change to existing
  columns).
- `TaskRepository.listByUser` and `findById` add `include: { subtasks: { orderBy: { createdAt: 'asc' } } }`.
  Their return type becomes a `Prisma.TaskGetPayload<{ include: { subtasks: true } }>` (exported as e.g.
  `TaskWithSubtasks`). `toFlexibleTask(row)` is unchanged — the payload still satisfies the base `Task`
  shape it reads (`durationMs`, `dueBy`, …) and ignores `subtasks`.
  - **Scheduler/core stays decoupled from the include.** `@notreclaim/core`'s `SchedulingRepositories.tasks`
    is currently `Pick<TaskRepository, 'listByUser'>`; to avoid coupling the engine to subtasks, change it
    to an inline structural type requiring only base `Task[]`
    (`{ listByUser(userId: string, opts?: { status?: TaskStatus }): Promise<Task[]> }`). The real
    repo's widened `TaskWithSubtasks[]` is assignable to that, and the core test fake (returning base
    `Task[]`) needs no change. The widened `TaskRepository` does ripple to the **server** fake
    (`fakeTaskRepo.make` gains `subtasks: []`) so it still conforms to `TaskRepository`.
- New `SubtaskRepository` (`repositories/subtask-repository.ts`):
  - `create(userId, taskId, { title }): Promise<Subtask>` — verifies the parent task belongs to the user
    (e.g. `task.findFirst({ where: { id: taskId, userId } })` → `NotFoundError` if absent), then creates.
  - `update(userId, id, { title?, done? }): Promise<Subtask>` — `updateMany({ where: { id, task: { userId } }, data })`;
    `count === 0` → `NotFoundError`; then `findUniqueOrThrow`.
  - `delete(userId, id): Promise<void>` — `deleteMany({ where: { id, task: { userId } } })`;
    `count === 0` → `NotFoundError`.
- db index exports `createSubtaskRepository` + `SubtaskRepository`/`CreateSubtaskInput`/`UpdateSubtaskInput`
  + the `Subtask` Prisma type.

### Server — `@notreclaim/server`
- `schemas.ts`: `createSubtaskSchema = z.object({ taskId: z.string().min(1), title: z.string().min(1) })`;
  `updateSubtaskSchema = z.object({ title: z.string().min(1).optional(), done: z.boolean().optional() })
  .refine(b => b.title !== undefined || b.done !== undefined)`.
- New `subtask-routes.ts` `registerSubtaskRoutes(app, deps)` (no `afterMutation` param — subtasks don't
  re-plan): guarded `POST /subtasks` (→ `repos.subtasks.create(userId, body.taskId, { title })`, 201),
  `PATCH /subtasks/:id` (→ `update`), `DELETE /subtasks/:id` (→ `delete`, 204).
- `app.ts`: `AppDeps.repos.subtasks: SubtaskRepository`; register the routes. `server.ts`: wire the real
  repo.

### Web — `@notreclaim/web`
- `api/types.ts`: `Subtask { id; taskId; title; done: boolean }`; `Task.subtasks?: Subtask[]`;
  `CreateSubtaskInput { taskId; title }`; `UpdateSubtaskInput { title?; done? }`.
- `api/client.ts`: `createSubtask(body)`, `updateSubtask(id, patch)`, `deleteSubtask(id)` (+ fake base
  entries).
- `api/queries.ts`: `useCreateSubtaskMutation`/`useUpdateSubtaskMutation`/`useDeleteSubtaskMutation`, each
  invalidating **`tasksRoot` only** (subtasks don't reschedule, so not `scheduleRoot`).
- **`TaskDrawer.tsx`**: a "Subtasks" section rendering `task.subtasks ?? []` — each row a checkbox
  (toggle `done`) + label + a delete button; plus a "+ add subtask" text input that creates on
  submit. (Reads subtasks from the live `task` prop, not local form state.)
- **`Priorities.tsx`**: store `editingId: string | null` instead of the task object; derive
  `editing = tasksQ.data?.find((t) => t.id === editingId) ?? null`; pass it to the drawer. This makes
  subtask mutations (which refetch `tasksRoot`) flow fresh `subtasks` into the open drawer.
- **`TaskRow.tsx`**: when `(task.subtasks ?? []).length > 0`, render a small badge in the meta line, e.g.
  `✓ {done}/{total}` (done = subtasks with `done === true`).

### Data flow
Add/toggle/delete in the drawer → `POST`/`PATCH`/`DELETE /subtasks` → server mutates via
`SubtaskRepository` (ownership-scoped) → web invalidates `tasksRoot` → `/tasks` refetches tasks-with-
subtasks → the drawer (re-derived by id) shows the updated list AND the board card badge updates. No
schedule query touched.

## Error handling
- Server: zod failure → 400; a subtask op on another user's task (or a missing task/subtask) →
  `NotFoundError` → 404 via the existing mapper.
- Web: mutation failure surfaces via the drawer's existing error affordance; the add-input is disabled
  while empty / pending.

## Testing (vitest; `TZ=UTC`; no real Google; Postgres for `@notreclaim/db`)
- **db `SubtaskRepository`** (real Postgres): create under a task; list-with-task includes subtasks in
  creation order; update title + toggle `done`; delete; **ownership** (another user's subtask → 404 on
  update/delete; create under another user's task → 404); **cascade** (deleting the task deletes its
  subtasks). Add `Subtask` to the test TRUNCATE list.
- **Server routes:** `POST`/`PATCH`/`DELETE /subtasks` happy paths; 400 (bad body); 404 (other user's
  task/subtask). (Fake subtask repo in `buildTestApp`.)
- **Web:** client methods issue the right verb/URL; mutation hooks invalidate `tasksRoot`; `TaskDrawer`
  renders subtasks, adds one (calls `createSubtask`), toggles one (calls `updateSubtask`), deletes one;
  `TaskRow` shows `done/total` when subtasks exist and nothing when empty; `Priorities` re-derives the
  editing task by id.
- Full monorepo suite (Postgres up) + `npm run build -w @notreclaim/web` green.

## Scope / decomposition (for the plan)
~6 sequential TDD tasks:
1. **DB:** `Subtask` model + migration + `Task.subtasks` include on the task repo + `SubtaskRepository`
   + db index exports + TRUNCATE list + tests.
2. **Server:** subtask schemas + `subtask-routes` CRUD + `AppDeps`/`app.ts`/`server.ts` wiring + fake repo
   + tests.
3. **Web API:** `Subtask`/`CreateSubtaskInput`/`UpdateSubtaskInput` DTOs + `Task.subtasks?` + client
   methods + query hooks + fakes + tests.
4. **Web — TaskDrawer Subtasks section** + `Priorities` editing-by-id re-derive + tests.
5. **Web — TaskRow count badge** + tests.
6. **Verification:** full monorepo suite (Postgres up) + web build; whole-branch review.
