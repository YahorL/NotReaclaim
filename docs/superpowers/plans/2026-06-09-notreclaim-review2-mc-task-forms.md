# Review 2 M-C: Reclaim-Style Task Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the default-browser-control look in the task edit drawer by rebuilding it from the New Task modal's Reclaim-style primitives (bordered FieldBoxes with the label inside, ±15-min duration steppers, pill buttons), extracted into shared components.

**Architecture:** The New Task modal (`app/shell/NewTaskModal.tsx`) is ALREADY Reclaim-styled with private `Field`/`Stepper` helpers — the user-visible offender is `app/tasks/TaskDrawer.tsx` (gray `border-gray-300` default controls, w-60). Step 1 extracts the modal's helpers verbatim into `app/components/FieldBox.tsx` + `app/components/DurationStepper.tsx` (pure refactor; modal behavior and tests unchanged). Step 2 rebuilds the drawer with them — all testids, validation, mutations preserved except the three `DurationField` h/m inputs which become steppers (their tests updated accordingly). `DurationField` itself stays (Habits + Settings still use it).

**Tech Stack:** React 18 + TypeScript, Tailwind tokens (line/ink/inkSoft/indigo/crit/card), vitest + RTL.

**Branch:** `feat/review2-mc-task-forms` off `main`. Spec: `docs/superpowers/specs/2026-06-09-notreclaim-review-2-design.md` (§M-C).

---

### Task 1: Branch + extract FieldBox & DurationStepper, refactor NewTaskModal (pure refactor)

**Files:**
- Create: `packages/web/src/app/components/FieldBox.tsx`
- Create: `packages/web/src/app/components/DurationStepper.tsx`
- Modify: `packages/web/src/app/shell/NewTaskModal.tsx`

- [ ] **Step 1: Create the milestone branch**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git checkout -b feat/review2-mc-task-forms main
```

- [ ] **Step 2: Create the shared components** (lifted verbatim from NewTaskModal — `Field` → `FieldBox`, `Stepper` → `DurationStepper` with a new optional `size` prop defaulting to the modal's 26)

`packages/web/src/app/components/FieldBox.tsx`:

```tsx
import type { ReactNode } from 'react';

/** Reclaim-style bordered field: small grey label inside the box, bold content under it. */
export function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
      <span className="text-[13px] font-semibold text-inkSoft">{label}</span>
      {children}
    </div>
  );
}
```

`packages/web/src/app/components/DurationStepper.tsx`:

```tsx
import { msToHM } from '../lib/duration';
import { Icons } from '../shell/icons';

const STEP = 15 * 60_000;

export function durationLabel(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${minutes} mins`;
}

/** Bold human duration + circular ∓ buttons stepping ±15 min (floor 15 min). */
export function DurationStepper({ valueMs, onChange, disabled = false, label, size = 26 }: {
  valueMs: number; onChange: (ms: number) => void; disabled?: boolean; label: string; size?: number;
}) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[18px] font-bold">{durationLabel(valueMs)}</span>
      <div className="flex gap-2 text-indigo">
        <button type="button" aria-label={`decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(STEP, valueMs - STEP))} className="disabled:opacity-40"><Icons.minusCircle size={size} /></button>
        <button type="button" aria-label={`increase ${label}`} disabled={disabled} onClick={() => onChange(valueMs + STEP)} className="disabled:opacity-40"><Icons.plusCircle size={size} /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Refactor NewTaskModal to use them**

In `NewTaskModal.tsx`:
1. Delete the local `durationLabel`, `STEP`, `Stepper`, and `Field` definitions (lines ~10–38).
2. Remove the now-unused `msToHM` import and `ReactNode` type import.
3. Add `import { FieldBox } from '../components/FieldBox';` and `import { DurationStepper } from '../components/DurationStepper';`.
4. Replace every `<Field ` with `<FieldBox ` (and closing tags) and every `<Stepper ` with `<DurationStepper `.
Nothing else changes — same labels, aria-labels, testids, behavior.

- [ ] **Step 4: Run the modal + components tests to verify the refactor is invisible**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/shell/NewTaskModal.test.tsx && npx tsc -p tsconfig.json --noEmit
```

Expected: NewTaskModal tests pass UNCHANGED (zero edits to the test file); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/components/FieldBox.tsx packages/web/src/app/components/DurationStepper.tsx packages/web/src/app/shell/NewTaskModal.tsx
git commit -m "refactor(web): extract FieldBox + DurationStepper from NewTaskModal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rebuild TaskDrawer Reclaim-style (TDD)

**Files:**
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx` (full rewrite of the JSX; logic/hooks/props unchanged)
- Test: `packages/web/src/app/tasks/TaskDrawer.test.tsx` (two tests updated for the stepper controls; everything else untouched)

Preserved contract: props (`task,onSave,onCancel,saving,error`), testids `task-drawer`, `save`, `schedule-after`, `category-select`, `err-*`, `drawer-error`, `subtask-toggle-*`, `subtask-delete-*`, `subtask-input`, `subtask-add`, the Cancel button's accessible name, the "— none —" category option, status select options, and all form/mutation behavior. Changed: visual system (FieldBox/DurationStepper/pill buttons, w-[300px] card) and the three duration controls (h/m inputs → steppers with aria-labels `increase/decrease duration|min|max`).

- [ ] **Step 1: Update the two affected tests (failing first)**

In `TaskDrawer.test.tsx`:

(a) In `'prefills from the task and saves a converted patch'`, replace the two `duration-h`/`duration-m` assertions with:

```tsx
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
```

(b) Replace the body of `'blocks save and shows an error when min chunk > max chunk'` with:

```tsx
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    // min chunk starts at 30m; 7 × +15m = 135m > the 120m max chunk
    const inc = screen.getByRole('button', { name: 'increase min' });
    for (let i = 0; i < 7; i++) fireEvent.click(inc);
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-maxChunkMs')).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/tasks/TaskDrawer.test.tsx
```

Expected: the two updated tests FAIL (no `1 hr 30 min` text, no `increase min` button); the other six still pass.

- [ ] **Step 3: Rebuild the drawer**

Replace `TaskDrawer.tsx` with:

```tsx
import { useState } from 'react';
import type { Task, TaskStatus, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';

const STATUSES: TaskStatus[] = ['pending', 'scheduled', 'completed', 'archived'];

export interface TaskDrawerProps {
  task: Task;
  onSave: (patch: UpdateTaskInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
}

export function TaskDrawer({ task, onSave, onCancel, saving = false, error = null }: TaskDrawerProps) {
  const [form, setForm] = useState<TaskFormState>(() => toFormState(task));
  const { ok, errors } = validateTaskForm(form);
  const categoriesQ = useCategoriesQuery();
  const categories = categoriesQ.data ?? [];
  const createSubtaskM = useCreateSubtaskMutation();
  const updateSubtaskM = useUpdateSubtaskMutation();
  const deleteSubtaskM = useDeleteSubtaskMutation();
  const [newSubtask, setNewSubtask] = useState('');
  const subtasks = task.subtasks ?? [];
  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const ctl = 'w-full bg-transparent text-[16px] font-bold text-ink outline-none';
  const errCls = 'mt-0.5 text-[11px] text-crit';

  return (
    <aside data-testid="task-drawer" className="w-[300px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop">
      <h4 className="text-[15px] font-bold text-ink">Edit task</h4>

      <div>
        <FieldBox label="Title">
          <input className={ctl} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </FieldBox>
        {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
      </div>

      <div>
        <FieldBox label="Duration">
          <DurationStepper label="duration" size={22} valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} />
        </FieldBox>
        {errors.durationMs && <p data-testid="err-durationMs" className={errCls}>{errors.durationMs}</p>}
      </div>

      <FieldBox label="Priority (lower = scheduled first)">
        <input type="number" className={ctl} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
      </FieldBox>

      <div>
        <FieldBox label="Due by">
          <input type="datetime-local" className={ctl} value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} />
        </FieldBox>
        {errors.dueByLocal && <p data-testid="err-dueByLocal" className={errCls}>{errors.dueByLocal}</p>}
      </div>

      <FieldBox label="Schedule after">
        <input type="datetime-local" data-testid="schedule-after" className={ctl} value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} />
      </FieldBox>

      <div>
        <FieldBox label="Min chunk">
          <DurationStepper label="min" size={22} valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} />
        </FieldBox>
        {errors.minChunkMs && <p data-testid="err-minChunkMs" className={errCls}>{errors.minChunkMs}</p>}
      </div>
      <div>
        <FieldBox label="Max chunk">
          <DurationStepper label="max" size={22} valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} />
        </FieldBox>
        {errors.maxChunkMs && <p data-testid="err-maxChunkMs" className={errCls}>{errors.maxChunkMs}</p>}
      </div>

      <FieldBox label="Hours">
        <select data-testid="category-select" className={`${ctl} appearance-none`} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
          <option value="">— none —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </FieldBox>

      <FieldBox label="Status">
        <select className={`${ctl} appearance-none capitalize`} value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </FieldBox>

      <div>
        <span className="mb-1 block text-[13px] font-semibold text-inkSoft">Subtasks</span>
        <ul className="mb-1.5 space-y-1.5">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" data-testid={`subtask-toggle-${s.id}`} checked={s.done} onChange={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })} className="h-4 w-4 accent-indigo" />
              <span className={`flex-1 ${s.done ? 'text-inkSoft line-through' : 'text-ink'}`}>{s.title}</span>
              <button type="button" data-testid={`subtask-delete-${s.id}`} aria-label="delete subtask" onClick={() => deleteSubtaskM.mutate(s.id)} className="text-[13px] font-bold text-crit">×</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1.5">
          <input data-testid="subtask-input" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask…" className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5 text-[14px] outline-none focus:border-indigo" />
          <button type="button" data-testid="subtask-add" disabled={!newSubtask.trim() || createSubtaskM.isPending}
            onClick={() => createSubtaskM.mutate({ taskId: task.id, title: newSubtask.trim() }, { onSuccess: () => setNewSubtask('') })}
            className="rounded-[20px] bg-indigo px-3 text-[13px] font-bold text-white disabled:opacity-50">Add</button>
        </div>
      </div>

      {error && <p data-testid="drawer-error" className={errCls}>{error.message}</p>}

      <div className="flex gap-2 pt-1">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}
          className="rounded-[30px] bg-indigo px-5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-[30px] border border-line px-5 py-2 text-[14px] font-bold text-inkSoft hover:bg-bg">Cancel</button>
      </div>
    </aside>
  );
}
```

(`DurationField` import is gone from this file but the component stays — Habits/Settings use it.)

- [ ] **Step 4: Run drawer tests, then the full web suite + typecheck**

```bash
TZ=UTC npx vitest run src/app/tasks/TaskDrawer.test.tsx
cd /home/nyx-ai/Projects/NotReclaim/packages/web && npm test && npx tsc -p tsconfig.json --noEmit
```

Expected: all 8 drawer tests pass; full web suite green (216); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx
git commit -m "feat(web): Reclaim-style task edit drawer (FieldBox + duration steppers + pill buttons)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Full suite + live verification + merge

- [ ] **Step 1: Run the whole monorepo suite**

```bash
cd /home/nyx-ai/Projects/NotReclaim
npm test
```

Expected: all workspaces green (455 total, unchanged count — no new tests, two rewritten).

- [ ] **Step 2: Verify live**

In the running app: open a task on the Priorities board — the drawer should show bordered label-inside boxes, ± duration steppers, pill Save. Open New Task — identical styling (unchanged).

- [ ] **Step 3: Hand off to finishing-a-development-branch**

Merge `feat/review2-mc-task-forms` into `main` (suite green, delete branch).
