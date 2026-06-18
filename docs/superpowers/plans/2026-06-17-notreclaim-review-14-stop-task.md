# Review 14 — Stop the Running Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT SAFETY (all subagents):** Do NOT run `git checkout`, `git switch`, `git reset`, `git branch`, or `git stash`. Stay on `feat/review14-stop-task`; commit with `git add <named files>` + `git commit` only. Read-only git (`git diff`, `git log`, `git show`) is fine. (A prior review subagent switched branches and derailed work onto main.)

**Goal:** Add a Stop action that ends the running task now (end → nearest-15-min current time, start kept), and make the top-bar widget show the running task with Stop or the next task with Start.

**Architecture:** A `POST /schedule/:id/stop` endpoint mirrors `start` but moves the *end* (clamped to `[start+15min, originalEnd]`). The web gets a `stopBlock` client call + `useStopBlockMutation`. `TopBar` becomes "current-or-next": a *started* task block spanning now → Stop; else the next future task block → Start. A started block whose end is before now no longer spans now, so it isn't "running" (fixes "still shows as started").

**Tech Stack:** `@notreclaim/server` (Fastify) + `@notreclaim/web` (React + React Query). Vitest. Run tests per-package; web with `TZ=UTC`.

**Spec:** `docs/superpowers/specs/2026-06-17-notreclaim-review-14-design.md`

---

## File structure

- Modify `packages/server/src/schedule-routes.ts` — add `POST /schedule/:id/stop`.
- Modify `packages/server/test/schedule.test.ts` — stop-route tests.
- Modify `packages/web/src/api/client.ts` — `stopBlock`.
- Modify `packages/web/src/test/fakes.tsx` — `stopBlock` default.
- Modify `packages/web/src/api/queries.ts` — `useStopBlockMutation`.
- Modify `packages/web/src/app/shell/TopBar.tsx` — current-or-next widget.
- Modify `packages/web/src/app/shell/TopBar.test.tsx` — widget tests.

---

## Preconditions

- [ ] On branch `feat/review14-stop-task` (already created). Postgres only needed if running server tests — start it if down:
  `/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start`

---

## Task 1: Server — `POST /schedule/:id/stop`

**Files:**
- Modify: `packages/server/src/schedule-routes.ts`
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Write failing tests.** In `schedule.test.ts`, append a new `describe` (the file already has `block()` + `settings()` helpers and `FIXED_NOW = 2026-01-05T00:00:00Z`):

```ts
describe('POST /schedule/:id/stop', () => {
  it('snaps the end to the nearest 15 min of now, keeping the start', async () => {
    // block 2026-01-04T23:00 → 2026-01-05T01:00 spans FIXED_NOW (00:00); round15(00:00)=00:00
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:00:00.000Z'), endsAt: new Date('2026-01-05T01:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-04T23:00:00.000Z'); // start unchanged
    expect(res.json().endsAt).toBe('2026-01-05T00:00:00.000Z');   // end snapped to now
    expect(res.json().pinned).toBe(true);
  });

  it('floors the end to start + 15 min when now is at/before the start', async () => {
    // block starts exactly at FIXED_NOW (00:00); round15(now)=00:00 ≤ start → floor to 00:15
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T00:00:00.000Z'), endsAt: new Date('2026-01-05T02:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().endsAt).toBe('2026-01-05T00:15:00.000Z');
  });

  it('never extends the end past the original end', async () => {
    // block already ended (23:00 → 23:30, before FIXED_NOW 00:00); end must not jump to 00:00
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:00:00.000Z'), endsAt: new Date('2026-01-04T23:30:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/stop', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().endsAt).toBe('2026-01-04T23:30:00.000Z'); // unchanged
  });

  it('404s an unknown block and 400s a habit block', async () => {
    const habitBlock = block({ id: 'h1', taskId: null, habitId: 'hab1' });
    const { app } = buildTestApp({ blocks: [habitBlock], settings: settings() });
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'POST', url: '/schedule/none/stop', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/schedule/h1/stop', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (route not found / 404 for all).

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: FAIL on the new describe.

- [ ] **Step 3: Implement.** In `schedule-routes.ts`, add this handler immediately after the `POST /schedule/:id/start` handler (before `DELETE /schedule/:id`):

```ts
  app.post('/schedule/:id/stop', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) {
      reply.code(404).send({ code: 'not_found', message: `ScheduledBlock ${id} not found` });
      return;
    }
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: 'Only task blocks can be stopped' });
      return;
    }
    const now = deps.now();
    const startMs = blockRow.startsAt.getTime();
    const endMs = blockRow.endsAt.getTime();
    const minEnd = startMs + 15 * 60 * 1000;
    // End the running block now: snap end to the nearest 15 min, never below start+15 min
    // (no zero-length block) and never past the original end (Stop only shortens).
    const newEnd = Math.min(endMs, Math.max(round15(now), minEnd));
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, { endsAt: new Date(newEnd), pinned: true });
    afterMutation(request.userId);
    return block;
  });
```

(`round15` is already imported in this file; `findById` is already on the `scheduledBlocks` Pick.)

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: PASS.

- [ ] **Step 5: Full server suite + build, then commit.**

Run: `npm --workspace @notreclaim/server test && npm --workspace @notreclaim/server run build`
Expected: all pass; tsc clean.

```bash
git add packages/server/src/schedule-routes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): POST /schedule/:id/stop ends the running block at the snapped now"
```

---

## Task 2: Web — `stopBlock` client + `useStopBlockMutation`

**Files:**
- Modify: `packages/web/src/api/client.ts`, `packages/web/src/test/fakes.tsx`, `packages/web/src/api/queries.ts`

- [ ] **Step 1: Client method.** In `client.ts`, add to the `ApiClient` interface right after `startBlock`:

```ts
  startBlock(id: string): Promise<ScheduledBlock>;
  stopBlock(id: string): Promise<ScheduledBlock>;
```

and to the returned implementation object right after `startBlock`:

```ts
    startBlock: (id) => request('POST', `/schedule/${id}/start`),
    stopBlock: (id) => request('POST', `/schedule/${id}/stop`),
```

- [ ] **Step 2: Fake default.** In `packages/web/src/test/fakes.tsx`, add to the `base` object right after `startBlock`:

```ts
    startBlock: notImplemented('startBlock'),
    stopBlock: notImplemented('stopBlock'),
```

- [ ] **Step 3: Mutation hook.** In `queries.ts`, add right after `useStartBlockMutation`:

```ts
export function useStopBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.stopBlock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
    },
  });
}
```

- [ ] **Step 4: Build (typecheck) + full web suite.**

Run: `npm --workspace @notreclaim/web run build && (cd packages/web && npm test)`
Expected: tsc + vite clean; all web tests pass (additive — no behavior change yet).

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/api/client.ts packages/web/src/test/fakes.tsx packages/web/src/api/queries.ts
git commit -m "feat(web): stopBlock client + useStopBlockMutation"
```

---

## Task 3: Top-bar current-or-next widget

**Files:**
- Modify: `packages/web/src/app/shell/TopBar.tsx`
- Test: `packages/web/src/app/shell/TopBar.test.tsx`

- [ ] **Step 1: Write failing tests.** In `TopBar.test.tsx`, inside the `describe('TopBar Next-task indicator', …)` block, add (NOW_MS = `2026-06-11T12:00:00Z`, `nowFn`, and the `block()` helper already exist):

```ts
  it('shows the running (started, in-progress) task with a Stop button', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'r1', title: 'Deep work',
        startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z',
      })],
      stopBlock,
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.getByTestId('current-task')).toBeInTheDocument());
    expect(screen.getByTestId('current-task').textContent).toContain('Deep work');
    expect(screen.queryByTestId('next-task')).toBeNull();
    fireEvent.click(screen.getByTestId('stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('r1'));
  });

  it('does not treat a started block whose end has passed as running', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'done', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T09:00:00Z',
      })],
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.queryByTestId('current-task')).toBeNull());
    expect(screen.queryByTestId('next-task')).toBeNull(); // ended, and no future task
  });
```

- [ ] **Step 2: Run — expect FAIL** (`current-task`/`stop-task` not found).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `TopBar.tsx`:

Add `useStopBlockMutation` to the queries import:

```ts
import { useScheduleQuery, useStartBlockMutation, useStopBlockMutation } from '../../api/queries';
```

Replace the `startBlock`/`nextBlock` derivation (the lines from `const startBlock = useStartBlockMutation();` through the `nextBlock` definition) with:

```ts
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();

  const taskBlocks = (scheduleQ.data ?? []).filter((b) => b.taskId != null);
  const running = taskBlocks
    .filter((b) => b.startedAt != null && Date.parse(b.startsAt) <= nowMs && Date.parse(b.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
  const nextBlock = running
    ? null
    : taskBlocks
        .filter((b) => Date.parse(b.startsAt) > nowMs)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
```

Replace the entire `{nextBlock && ( … )}` JSX block with both branches:

```tsx
      {running && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="current-task"
            onClick={() => void navigate('/')}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-ink/70 hover:bg-line"
          >
            <Icons.clock size={16} />
            Now: {running.title}
          </button>
          <button
            type="button"
            data-testid="stop-task"
            onClick={() => stopBlock.mutate(running.id)}
            className="rounded-[9px] bg-crit px-3 py-2 text-[13px] font-bold text-white hover:opacity-90"
          >
            Stop
          </button>
        </div>
      )}

      {nextBlock && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="next-task"
            onClick={() => void navigate('/')}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-ink/70 hover:bg-line"
          >
            <Icons.clock size={16} />
            Next: {nextBlock.title} · {relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs)}
          </button>
          <button
            type="button"
            data-testid="next-task-start"
            onClick={() => startBlock.mutate(nextBlock.id)}
            className="rounded-[9px] bg-indigo px-3 py-2 text-[13px] font-bold text-white hover:bg-indigo600"
          >
            Start
          </button>
        </div>
      )}
```

(This removes the old `next-task-started` span entirely — a started block now shows as the running task with Stop, never as a "Started" next task.)

- [ ] **Step 4: Run — expect PASS** (new + existing TopBar tests; the existing next-task / hidden / start tests still hold).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full web suite + build, then commit.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all pass; clean build.

```bash
git add packages/web/src/app/shell/TopBar.tsx packages/web/src/app/shell/TopBar.test.tsx
git commit -m "feat(web): top-bar current-or-next widget with a Stop button"
```

---

## Task 4: Verify & finish

- [ ] **Step 1: Full suites + build.**

```bash
npm --workspace @notreclaim/server test
(cd packages/web && npm test)
npm run build
```
Expected: all green; all workspaces compile.

- [ ] **Step 2: Rebuild + restart the API, restart Vite (clear cache), live-verify via geckodriver.**

- API: `set -a && . ./.env.run && set +a && node packages/server/dist/server.js` (:3000).
- Vite: `cd packages/web && rm -rf node_modules/.vite && npm run dev` (:5173).
- With the demo token + `TZ=UTC` geckodriver: Start the upcoming task → the widget flips to **"Now: … [Stop]"** (a started block spanning now). Click **Stop** → the block's end snaps to now and the widget clears (no running task) → falls back to the next task with Start. Confirm no `next-task-started` label appears.

- [ ] **Step 3: Update memory** (`project-status.md` + `MEMORY.md`) with a one-line Review 14 summary.

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review14-stop-task` to `main`.

---

## Self-review notes (reconciled)

- **Spec coverage:** Stop endpoint (Task 1); client/query (Task 2); current-or-next widget + running = started-and-spanning-now, which makes an ended started block stop being "running" (Task 3, fixes item 4). The hide-button staleness and the Today-button question were diagnostics, not code — out of scope per the spec.
- **Type/name consistency:** `stopBlock`, `useStopBlockMutation`, testids `current-task` / `stop-task` / `next-task` / `next-task-start`; `round15` reused; clamp `min(endMs, max(round15(now), start+15min))`.
- **No silent caps:** the clamp floor (`start+15min`) and ceiling (`originalEnd`) are explicit and tested.
