# Review 2 M-B: Subtasks Fix + On-Card Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subtask/category mutations actually reach the API in dev (Vite proxy fix), and render each task's subtasks as a toggleable checklist directly on its Priorities board card.

**Architecture:** Two independent fixes. (1) `packages/web/vite.config.ts` is missing proxy entries for `/subtasks` and `/categories`, so those requests die against the Vite dev server — one-object fix. (2) `TaskRow` (presentational, callback-driven) gains an `onToggleSubtask` callback rendered as a checkbox list; the callback threads `Priorities → Board → Column → TaskRow` and is wired to the existing `useUpdateSubtaskMutation` in the `Priorities` page (matching how `onComplete` works today).

**Tech Stack:** React 18 + TypeScript, TanStack Query, Tailwind, vitest + @testing-library/react (jsdom). Web tests run with `TZ=UTC` (the package `test` script sets it).

**Branch:** `feat/review2-mb-subtasks` off `main`. Spec: `docs/superpowers/specs/2026-06-09-notreclaim-review-2-design.md` (§M-B).

---

### Task 1: Branch + Vite proxy fix

**Files:**
- Modify: `packages/web/vite.config.ts:10-20`

- [ ] **Step 1: Create the milestone branch**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git checkout -b feat/review2-mb-subtasks main
```

- [ ] **Step 2: Add the missing proxy entries**

In `packages/web/vite.config.ts`, the `proxy` object currently lists `/auth/google`, `/tasks`, `/habits`, `/settings`, `/schedule`, `/calendar`, `/ws`. Add two entries (order within the object doesn't matter; keep alphabetical-ish grouping with the others):

```ts
    proxy: {
      // Only the server's auth endpoints live under /auth/google; /auth/callback is a
      // client-side route (the redirect-with-token landing) and must NOT be proxied.
      '/auth/google': API,
      '/tasks': API,
      '/subtasks': API,
      '/habits': API,
      '/settings': API,
      '/schedule': API,
      '/calendar': API,
      '/categories': API,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
```

- [ ] **Step 3: Verify the proxy forwards (manual smoke)**

With the API server on :3000 and `npm run dev` on :5173 (both already running in this session — if not, see memory `project-status.md` local-run notes):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5173/subtasks
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/categories
```

Expected: `401` for both (the Fastify JWT guard answered — i.e., the request reached the API). Before the fix these return `404`/HTML from Vite. Note: Vite picks up `vite.config.ts` changes by restarting itself automatically; give it a second after saving.

- [ ] **Step 4: Commit**

```bash
git add packages/web/vite.config.ts
git commit -m "fix(web): proxy /subtasks and /categories to the API in dev

The F1/C client routes were never forwarded by the Vite dev proxy, so
subtask and category mutations silently hit the SPA server (the subtask
Add button appeared dead in dev).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TaskRow on-card subtask checklist (component, TDD)

**Files:**
- Modify: `packages/web/src/app/priorities/TaskRow.tsx`
- Test: `packages/web/src/app/priorities/TaskRow.test.tsx`

`TaskRow` is presentational: it must NOT use mutation hooks (its tests render it bare, without providers). It gains one prop:

```ts
onToggleSubtask: (subtaskId: string, done: boolean) => void; // done = the NEW value
```

- [ ] **Step 1: Write the failing tests**

In `TaskRow.test.tsx`, extend `renderRow` to accept the new callback and add a describe block. Full updated file:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void } = {}) {
  return render(
    <TaskRow
      task={task} bucket="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop} onDragStart={noop} onDragEnd={noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
    />,
  );
}

const twoSubtasks = [
  { id: 's1', taskId: 't', title: 'first step', done: true },
  { id: 's2', taskId: 't', title: 'second step', done: false },
];

describe('TaskRow subtask badge', () => {
  it('shows done/total when the task has subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
  });
  it('shows no badge when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
  });
});

describe('TaskRow subtask checklist', () => {
  it('renders one checkbox row per subtask, checked when done', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step')).toBeInTheDocument();
    expect(screen.getByText('second step')).toBeInTheDocument();
    expect(screen.getByTestId('card-subtask-s1')).toBeChecked();
    expect(screen.getByTestId('card-subtask-s2')).not.toBeChecked();
  });

  it('strikes through done subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step').className).toContain('line-through');
    expect(screen.getByText('second step').className).not.toContain('line-through');
  });

  it('toggling a checkbox reports the flipped value and does not open the editor', () => {
    const onToggleSubtask = vi.fn();
    const onEdit = vi.fn();
    renderRow({ ...base, subtasks: twoSubtasks } as Task, { onEdit, onToggleSubtask });
    fireEvent.click(screen.getByTestId('card-subtask-s2'));
    expect(onToggleSubtask).toHaveBeenCalledWith('s2', true);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('renders no checklist when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('card-subtasks')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
npx tsc -p tsconfig.json --noEmit ; TZ=UTC npx vitest run src/app/priorities/TaskRow.test.tsx
```

Expected: compile error (`onToggleSubtask` not in `TaskRowProps`) and/or the four new tests FAIL (`card-subtask-s1` not found). The two badge tests still pass.

- [ ] **Step 3: Implement the checklist in TaskRow**

In `TaskRow.tsx`: add the prop, and render the checklist inside the `min-w-0 flex-1` div, after the meta line. Changed parts:

```tsx
export interface TaskRowProps {
  task: Task;
  bucket: BucketKey;
  nextMs: number | null;
  now: number;
  dragging: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
}

export function TaskRow({ task, bucket, nextMs, now, dragging, onComplete, onEdit, onDelete, onDragStart, onDragEnd, onToggleSubtask }: TaskRowProps) {
```

and after the `<div className="mt-1 flex items-center gap-1.5 ...">…</div>` meta block, inside the same `min-w-0 flex-1` wrapper:

```tsx
        {subtasks.length > 0 && (
          <ul data-testid="card-subtasks" className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  data-testid={`card-subtask-${s.id}`}
                  checked={s.done}
                  onChange={() => onToggleSubtask(s.id, !s.done)}
                  className="h-3.5 w-3.5 accent-indigo"
                />
                <span className={s.done ? 'text-inkSoft line-through' : 'text-ink'}>{s.title}</span>
              </li>
            ))}
          </ul>
        )}
```

(`stopPropagation` on the `<ul>` keeps checkbox clicks from bubbling to the row's `onClick={() => onEdit(task)}`. `accent-indigo` works because `indigo` is a design token in `tailwind.config.js`.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/priorities/TaskRow.test.tsx
```

Expected: all TaskRow tests PASS. (Other suites will fail to compile until Task 3 threads the prop — that's expected; don't run the full suite yet.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx
git commit -m "feat(web): subtask checklist on the Priorities board card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Thread onToggleSubtask through Board/Column and wire it in Priorities (TDD)

**Files:**
- Modify: `packages/web/src/app/priorities/Board.tsx`
- Modify: `packages/web/src/app/priorities/Column.tsx`
- Modify: `packages/web/src/app/pages/Priorities.tsx`
- Test: `packages/web/src/app/pages/Priorities.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Append to the `describe('Priorities board', …)` block in `Priorities.test.tsx` (note `makeApi` spreads overrides, and `task()` builds fixtures; `updateSubtask` is part of the fake client):

```tsx
  it('toggles a subtask from the board card without opening the drawer', async () => {
    const updateSubtask = vi.fn(async () => ({ id: 's1', taskId: 'c1', title: 'step', done: true }));
    const listTasks = vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1, subtasks: [{ id: 's1', taskId: 'c1', title: 'step', done: false }] } as Partial<Task>),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateSubtask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('card-subtask-s1'));
    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { done: true }));
    expect(screen.queryByTestId('task-drawer')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/pages/Priorities.test.tsx
```

Expected: FAIL — compile error first (`onToggleSubtask` missing where `Board`/`Column` render `TaskRow`), then (once threading exists) the click can't find `card-subtask-s1` until Priorities passes the wired callback.

- [ ] **Step 3: Thread the prop**

`Board.tsx` — add to `BoardProps` and pass through (mirror how `onComplete` flows):

```ts
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
```

```tsx
export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask }: BoardProps) {
  // …in the Column render:
          onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
```

`Column.tsx` — same addition to `ColumnProps`, same pass-through to `<TaskRow … onToggleSubtask={onToggleSubtask} />`.

`pages/Priorities.tsx` — import the existing hook and wire it (next to the other mutations around line 35):

```tsx
import { useUpdateSubtaskMutation } from '../../api/queries'; // merge into the existing queries import
// …
  const subtaskM = useUpdateSubtaskMutation();
  const onToggleSubtask = (subtaskId: string, done: boolean) => subtaskM.mutate({ id: subtaskId, patch: { done } });
// …in the <Board …> element (around line 63):
            onMove={onMove} onComplete={onComplete} onEdit={(t) => setEditingId(t.id)} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
```

- [ ] **Step 4: Run the web suite to verify everything passes**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
npm test
```

Expected: all web tests PASS (197 + the 5 new = 202).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/priorities/Board.tsx packages/web/src/app/priorities/Column.tsx packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx
git commit -m "feat(web): wire board-card subtask toggles to the subtask mutation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Full suite + live verification

- [ ] **Step 1: Run the whole monorepo suite**

```bash
cd /home/nyx-ai/Projects/NotReclaim
npm test
```

Expected: all workspaces green (baseline 436 + 5 new web tests = 441).

- [ ] **Step 2: Verify live in the running app**

With both dev servers up: open the Priorities board, open a task drawer, add a subtask (the Add button must now work — request hits `POST /subtasks` through the proxy), see the checklist appear on the card, toggle it on the card, confirm the drawer reflects the toggle.

- [ ] **Step 3: Hand off to finishing-a-development-branch**

Merge `feat/review2-mb-subtasks` into `main` per the superpowers:finishing-a-development-branch skill.
