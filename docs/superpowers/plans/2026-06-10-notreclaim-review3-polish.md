# Review 3: Form Polish + Existing-Task Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the New-Task modal datetime overflow, default Schedule-after/Due-date times to 08:00 / 23:59, make the edit drawer scrollable (off-screen subtask Add button), and let the planner click-to-create popover pin an EXISTING task at the clicked slot.

**Architecture:** All in `packages/web`. Pure default-time change in `newTaskForm.ts`; CSS-only fixes in `NewTaskModal.tsx` + `TaskDrawer.tsx`; `CreatePopover` gains a task picker (`useTasksQuery`) whose non-empty selection bypasses `createTask` and calls the existing `POST /schedule` mutation directly.

**Branch:** `feat/review3-polish` off `main`. Spec: `docs/superpowers/specs/2026-06-10-notreclaim-review-3-design.md`.

---

### Task 1: Defaults + overflow + drawer scroll (TDD where logic changes)

**Files:**
- Modify: `packages/web/src/app/shell/newTaskForm.ts`
- Modify: `packages/web/src/app/shell/NewTaskModal.tsx` (two className edits)
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx` (one className edit)
- Test: `packages/web/src/app/shell/newTaskForm.test.ts`

- [ ] **Step 1: Branch**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git checkout -b feat/review3-polish main
```

- [ ] **Step 2: Failing default-time tests** — append to `newTaskForm.test.ts` (file already imports `defaultNewTaskForm`; tests run TZ=UTC):

```ts
describe('defaultNewTaskForm default times', () => {
  const NOW = Date.parse('2026-01-07T15:30:00.000Z'); // a Wednesday afternoon

  it('defaults Schedule after to today 08:00 local', () => {
    expect(defaultNewTaskForm(NOW).notBeforeLocal).toBe('2026-01-07T08:00');
  });

  it('defaults Due date to one week out at 23:59 local', () => {
    expect(defaultNewTaskForm(NOW).dueByLocal).toBe('2026-01-14T23:59');
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/shell/newTaskForm.test.ts
```

Expected: both new tests FAIL (`notBeforeLocal` is `''`; `dueByLocal` carries 15:30).

- [ ] **Step 4: Implement the defaults** — in `newTaskForm.ts`, add a local helper and change the two fields:

```ts
/** Local-time datetime-local string for the day of `ms` at hh:mm. */
function atLocalTime(ms: number, hours: number, minutes: number): string {
  const d = new Date(ms);
  d.setHours(hours, minutes, 0, 0);
  return isoToLocalInput(d.toISOString());
}
```

```ts
    dueByLocal: atLocalTime(now + 7 * DAY_MS, 23, 59),
    notBeforeLocal: atLocalTime(now, 8, 0),
```

(A 08:00 notBefore that is already in the past is a documented no-op constraint — fine.)

- [ ] **Step 5: Datetime overflow fix** — in `NewTaskModal.tsx`, both datetime inputs (`data-testid="schedule-after"` and `data-testid="due-date"`) change `className="text-[16px] font-bold text-ink outline-none"` → `className="w-full min-w-0 text-[15px] font-bold text-ink outline-none"`. Also add `min-w-0` to the FieldBox container so flex children may shrink: in `packages/web/src/app/components/FieldBox.tsx` change `flex flex-1 flex-col` → `flex min-w-0 flex-1 flex-col`.

- [ ] **Step 6: Drawer scroll fix** — in `TaskDrawer.tsx`, the `<aside data-testid="task-drawer" className="w-[300px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop">` gains `max-h-[calc(100vh-100px)] overflow-y-auto` (wrapper in Priorities.tsx is `fixed top-[84px]`; 100px keeps a bottom margin).

- [ ] **Step 7: Run gates**

```bash
TZ=UTC npx vitest run src/app/shell/ src/app/tasks/ && npx tsc -p tsconfig.json --noEmit
```

Expected: all green (modal/drawer behavior tests unaffected by CSS).

- [ ] **Step 8: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/shell/newTaskForm.ts packages/web/src/app/shell/newTaskForm.test.ts packages/web/src/app/shell/NewTaskModal.tsx packages/web/src/app/components/FieldBox.tsx packages/web/src/app/tasks/TaskDrawer.tsx
git commit -m "fix(web): task-form polish — 08:00/23:59 default times, datetime overflow, scrollable drawer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Existing-task picker in CreatePopover (TDD)

**Files:**
- Modify: `packages/web/src/app/planner/CreatePopover.tsx`
- Test: `packages/web/src/app/planner/CreatePopover.test.tsx`

Behavior: Task mode shows a select (`data-testid="task-select"`) above the title input — first option `➕ New task` (value `''`, default; current create-new behavior), then the user's active (pending/scheduled) tasks from `useTasksQuery`. Choosing an existing task hides the title input, enables Create regardless of title, relabels the button "Schedule task", and submit calls ONLY `createScheduledBlock({taskId, startsAt, endsAt})` (then `onClose`). Event mode untouched; existing tests must stay green unmodified (their `fakeApiClient()` has a rejecting `listTasks` → empty picker, which is fine).

- [ ] **Step 1: Failing tests** — append to `CreatePopover.test.tsx` (harness has `baseProps`, `renderWithProviders`, `fakeApiClient`; add `waitFor` to the RTL import if missing):

```tsx
  it('pins an existing task at the slot instead of creating a new one', async () => {
    const onClose = vi.fn();
    const listTasks = vi.fn(async () => [
      { id: 't1', userId: 'u1', title: 'Existing job', priority: 2, durationMs: 3_600_000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' },
      { id: 't2', userId: 'u1', title: 'Done job', priority: 2, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'completed', timeLoggedMs: 0, createdAt: '', updatedAt: '' },
    ]);
    const createTask = vi.fn();
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-1' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ listTasks, createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Existing job' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Done job' })).not.toBeInTheDocument(); // completed filtered out
    fireEvent.change(screen.getByTestId('task-select'), { target: { value: 't1' } });
    expect(screen.queryByTestId('create-title')).not.toBeInTheDocument(); // title hidden for existing
    const submit = screen.getByTestId('create-submit');
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveTextContent(/schedule task/i);
    fireEvent.click(submit);
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    }));
    expect(createTask).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('picker defaults to “new task” and keeps the create flow', async () => {
    const listTasks = vi.fn(async () => []);
    const createTask = vi.fn(async () => ({ id: 't-9' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-9' }));
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ listTasks, createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    expect((screen.getByTestId('task-select') as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('create-title')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
TZ=UTC npx vitest run src/app/planner/CreatePopover.test.tsx
```

Expected: both new tests FAIL (`task-select` absent). The 6 existing tests still pass.

- [ ] **Step 3: Implement** in `CreatePopover.tsx`:

1. Import `useTasksQuery` (merge into the queries import).
2. State + data:

```ts
  const [taskId, setTaskId] = useState('');
  const tasksQ = useTasksQuery();
  const activeTasks = (tasksQ.data ?? []).filter((t) => t.status === 'pending' || t.status === 'scheduled');
  const existingChosen = mode === 'task' && taskId !== '';
```

3. Submit guard becomes `if (pending || (!existingChosen && !title.trim())) return;` and the task branch becomes:

```ts
    } else if (existingChosen) {
      createBlockM.mutate({ taskId, startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose });
    } else {
      /* existing create-new chain unchanged */
    }
```

4. JSX: in Task mode, render the picker ABOVE the title input; hide the title input when an existing task is chosen:

```tsx
      {mode === 'task' && (
        <select
          data-testid="task-select"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="mb-2 w-full rounded-[9px] border-[1.5px] border-line bg-card px-2 py-1.5 text-[14px] font-semibold outline-none focus:border-indigo"
        >
          <option value="">➕ New task</option>
          {activeTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
      {!existingChosen && (
        <input … existing create-title input unchanged … />
      )}
```

5. Submit button: `disabled={(!existingChosen && !title.trim()) || pending}` and label `{mode === 'event' ? 'Create event' : existingChosen ? 'Schedule task' : 'Create task'}`.

- [ ] **Step 4: Run gates**

```bash
TZ=UTC npx vitest run src/app/planner/ && npm test && npx tsc -p tsconfig.json --noEmit
```

Expected: all green (227 + 4 new across both tasks = 231).

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/CreatePopover.test.tsx
git commit -m "feat(web): pin an existing task from the click-to-create popover

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Full suite + live verification + merge

- [ ] `cd /home/nyx-ai/Projects/NotReclaim && npm test` — all green (~479).
- [ ] Live: with the dev servers running, re-drive the WebDriver check (geckodriver flow) — drawer subtask Add button must now be reachable (scrollable drawer) and adding a subtask must 201; New Task modal datetime fields stay inside the card; popover Task mode lists existing tasks.
- [ ] Merge `feat/review3-polish` into main, suite green, delete branch.
