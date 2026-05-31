# Tasks & Habits Panels (Milestone 5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/tasks` and `/habits` CRUD pages in `packages/web` — quick-add, a filterable list with inline actions, and a right-side edit drawer — on top of the existing API client and 5b query infrastructure.

**Architecture:** A shared pure format lib (`app/lib/duration.ts`) and two shared presentational components (`QuickAdd`, `DurationField`). `api/queries.ts` gains habit query keys + query/mutation hooks (mutations invalidate the list root **and** `scheduleRoot`). Each domain has a pure form module (`taskForm.ts`/`habitForm.ts`: defaults, validation, conversions), a `Row`, an edit `Drawer`, and a page that composes them. **Creation is quick-add only (smart defaults); the drawer is edit-only.**

**Tech Stack:** React 18 + Vite + TS strict + TanStack Query v5; Vitest + @testing-library/react + jsdom. Web imports are EXTENSIONLESS; never `import React` (jsx:react-jsx; importing `useState`/`useMemo` from `react` is fine). Web tests run under `TZ=UTC`. The `build` script (`tsc -p tsconfig.json && vite build`) typechecks test files.

**Conventions reminder:** pure modules (`duration.ts`, `taskForm.ts`, `habitForm.ts`) take all inputs as arguments — no `Date.now()`/argless `new Date()`. The page components are the impure boundary (`now` prop defaults to `Date.now`, injected in tests). Tests use `fakeApiClient` + `renderWithProviders` from `src/test/fakes.tsx`; no real network.

---

## File Structure

**New shared:**
- `src/app/lib/duration.ts` (+ `.test.ts`) — ms↔h/m, minutes↔"HH:MM", ISO↔datetime-local, `formatDurationShort`.
- `src/app/components/QuickAdd.tsx` (+ `.test.tsx`) — title input → `onAdd(title)`.
- `src/app/components/DurationField.tsx` (+ `.test.tsx`) — h/m inputs over a ms value.

**Data layer:**
- `src/api/queries.ts` (modify) + `src/api/queries.test.tsx` (extend) — habit keys, list queries, CRUD mutations.

**Tasks:**
- `src/app/tasks/taskForm.ts` (+ `.test.ts`), `TaskRow.tsx` (+ test), `TaskDrawer.tsx` (+ test).
- `src/app/pages/Tasks.tsx` (replace placeholder) + `src/app/pages/Tasks.test.tsx`.

**Habits:**
- `src/app/habits/habitForm.ts` (+ `.test.ts`), `HabitRow.tsx` (+ test), `HabitDrawer.tsx` (+ test).
- `src/app/pages/Habits.tsx` (replace placeholder) + `src/app/pages/Habits.test.tsx`.
- `src/app/App.test.tsx` (modify — Habits-nav assertion + `authedApi` stub).

---

## Task 1: Shared pure lib `app/lib/duration.ts`

**Files:**
- Create: `packages/web/src/app/lib/duration.ts`
- Create: `packages/web/src/app/lib/duration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  msToHM, hmToMs, minutesToHHMM, hhmmToMinutes,
  isoToLocalInput, localInputToIso, formatDurationShort,
} from './duration';

describe('duration', () => {
  it('msToHM / hmToMs round-trip', () => {
    expect(msToHM(5_400_000)).toEqual({ hours: 1, minutes: 30 });
    expect(msToHM(1_800_000)).toEqual({ hours: 0, minutes: 30 });
    expect(hmToMs(1, 30)).toBe(5_400_000);
    expect(hmToMs(0, 30)).toBe(1_800_000);
  });
  it('minutesToHHMM / hhmmToMinutes round-trip', () => {
    expect(minutesToHHMM(360)).toBe('06:00');
    expect(minutesToHHMM(545)).toBe('09:05');
    expect(hhmmToMinutes('06:00')).toBe(360);
    expect(hhmmToMinutes('09:05')).toBe(545);
  });
  it('isoToLocalInput / localInputToIso round-trip (TZ=UTC)', () => {
    expect(isoToLocalInput('2026-06-01T17:00:00.000Z')).toBe('2026-06-01T17:00');
    expect(localInputToIso('2026-06-01T17:00')).toBe('2026-06-01T17:00:00.000Z');
  });
  it('formatDurationShort', () => {
    expect(formatDurationShort(3_600_000)).toBe('1h');
    expect(formatDurationShort(5_400_000)).toBe('1h 30m');
    expect(formatDurationShort(1_800_000)).toBe('30m');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/lib/duration.test.ts`
Expected: FAIL — `Cannot find module './duration'`.

- [ ] **Step 3: Create `src/app/lib/duration.ts`**

```ts
const MS_PER_MIN = 60_000;

export function msToHM(ms: number): { hours: number; minutes: number } {
  const totalMin = Math.round(ms / MS_PER_MIN);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

export function hmToMs(hours: number, minutes: number): number {
  return (hours * 60 + minutes) * MS_PER_MIN;
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map((n) => Number(n));
  return (h ?? 0) * 60 + (m ?? 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant → "YYYY-MM-DDTHH:MM" in local time (for <input type="datetime-local">). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local string (local time) → ISO instant. */
export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

export function formatDurationShort(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/lib/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/lib/duration.ts packages/web/src/app/lib/duration.test.ts
git commit -m "feat(web): pure duration/format lib (ms<->h:m, minutes<->HH:MM, ISO<->local)"
```

---

## Task 2: `api/queries.ts` — habit keys + list queries + CRUD mutations

**Files:**
- Modify: `packages/web/src/api/queries.ts`
- Modify: `packages/web/src/api/queries.test.tsx`

- [ ] **Step 1: Add failing tests to `src/api/queries.test.tsx`**

Add `useHabitsQuery`, `useCreateTaskMutation`, `useDeleteHabitMutation` to the import from `./queries`, then add these describe blocks (the `wrap`, `fakeApiClient`, `renderHook`, `waitFor` helpers already exist in the file):

```tsx
describe('useHabitsQuery', () => {
  it('calls listHabits and returns data', async () => {
    const listHabits = vi.fn(async () => [{ id: 'h1' }]);
    const api = fakeApiClient({ listHabits } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useHabitsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listHabits).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'h1' }]);
  });
});

describe('useCreateTaskMutation', () => {
  it('calls createTask and invalidates tasks + schedule', async () => {
    const createTask = vi.fn(async () => ({ id: 't1' }));
    const api = fakeApiClient({ createTask } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useCreateTaskMutation(), { wrapper: Wrapper });
    result.current.mutate({ title: 'A', priority: 3, durationMs: 1, dueBy: '2026-01-01T00:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, category: null });
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});

describe('useDeleteHabitMutation', () => {
  it('calls deleteHabit and invalidates habits + schedule', async () => {
    const deleteHabit = vi.fn(async () => undefined);
    const api = fakeApiClient({ deleteHabit } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useDeleteHabitMutation(), { wrapper: Wrapper });
    result.current.mutate('h1');
    await waitFor(() => expect(deleteHabit).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['habits'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: FAIL — `useHabitsQuery`/`useCreateTaskMutation`/`useDeleteHabitMutation` are not exported.

- [ ] **Step 3: Extend `src/api/queries.ts`**

Update the imports (line 1-2) to add the input types:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiProvider';
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput } from './types';
```

Add habit keys to the `queryKeys` object (after the `tasks` entry):

```ts
  habitsRoot: ['habits'] as const,
  habits: () => ['habits'] as const,
```

Append these hooks to the end of the file:

```ts
export function useTasksQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tasks(), queryFn: () => api.listTasks() });
}

export function useHabitsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.habits(), queryFn: () => api.listHabits() });
}

function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}
function invalidateHabits(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.habitsRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}

export function useCreateTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateTaskInput) => api.createTask(body), onSuccess: () => invalidateTasks(qc) });
}
export function useUpdateTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) => api.updateTask(id, patch), onSuccess: () => invalidateTasks(qc) });
}
export function useDeleteTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteTask(id), onSuccess: () => invalidateTasks(qc) });
}

export function useCreateHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateHabitInput) => api.createHabit(body), onSuccess: () => invalidateHabits(qc) });
}
export function useUpdateHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateHabitInput }) => api.updateHabit(id, patch), onSuccess: () => invalidateHabits(qc) });
}
export function useDeleteHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteHabit(id), onSuccess: () => invalidateHabits(qc) });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the fake already covers all methods + build**

The 5a `fakeApiClient` base already lists `listTasks/createTask/updateTask/deleteTask/listHabits/createHabit/updateHabit/deleteHabit` (verify in `src/test/fakes.tsx`). No fake change is needed.
Run: `npm run build -w @notreclaim/web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/queries.ts packages/web/src/api/queries.test.tsx
git commit -m "feat(web): habit query keys + task/habit list & CRUD mutation hooks"
```

---

## Task 3: Shared `QuickAdd` component

**Files:**
- Create: `packages/web/src/app/components/QuickAdd.tsx`
- Create: `packages/web/src/app/components/QuickAdd.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickAdd } from './QuickAdd';

describe('QuickAdd', () => {
  it('calls onAdd with the trimmed title on Enter and clears', () => {
    const onAdd = vi.fn();
    render(<QuickAdd placeholder="+ Add a task…" onAdd={onAdd} />);
    const input = screen.getByPlaceholderText('+ Add a task…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Write spec  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Write spec');
    expect(input.value).toBe('');
  });

  it('calls onAdd on button click and ignores empty input', () => {
    const onAdd = vi.fn();
    render(<QuickAdd placeholder="+ Add…" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('+ Add…'), { target: { value: 'Run' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith('Run');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/components/QuickAdd.test.tsx`
Expected: FAIL — `Cannot find module './QuickAdd'`.

- [ ] **Step 3: Create `src/app/components/QuickAdd.tsx`**

```tsx
import { useState } from 'react';

export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onAdd(title);
    setValue('');
  };
  return (
    <div className="mb-2 flex gap-2">
      <input
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Add</button>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/components/QuickAdd.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/components/QuickAdd.tsx packages/web/src/app/components/QuickAdd.test.tsx
git commit -m "feat(web): shared QuickAdd input component"
```

---

## Task 4: Shared `DurationField` component

**Files:**
- Create: `packages/web/src/app/components/DurationField.tsx`
- Create: `packages/web/src/app/components/DurationField.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationField } from './DurationField';

describe('DurationField', () => {
  it('shows hours/minutes from a ms value', () => {
    render(<DurationField valueMs={5_400_000} onChange={vi.fn()} testid="dur" />);
    expect((screen.getByTestId('dur-h') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('dur-m') as HTMLInputElement).value).toBe('30');
  });

  it('emits ms when hours change', () => {
    const onChange = vi.fn();
    render(<DurationField valueMs={5_400_000} onChange={onChange} testid="dur" />);
    fireEvent.change(screen.getByTestId('dur-h'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(9_000_000); // 2h30m
  });

  it('emits ms when minutes change', () => {
    const onChange = vi.fn();
    render(<DurationField valueMs={3_600_000} onChange={onChange} testid="dur" />);
    fireEvent.change(screen.getByTestId('dur-m'), { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith(4_500_000); // 1h15m
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/components/DurationField.test.tsx`
Expected: FAIL — `Cannot find module './DurationField'`.

- [ ] **Step 3: Create `src/app/components/DurationField.tsx`**

```tsx
import { msToHM, hmToMs } from '../lib/duration';

export interface DurationFieldProps {
  valueMs: number;
  onChange: (ms: number) => void;
  testid?: string;
}

export function DurationField({ valueMs, onChange, testid }: DurationFieldProps) {
  const { hours, minutes } = msToHM(valueMs);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number" min={0}
        data-testid={testid ? `${testid}-h` : undefined}
        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={hours}
        onChange={(e) => onChange(hmToMs(Number(e.target.value), minutes))}
      />
      <span className="text-xs text-gray-500">h</span>
      <input
        type="number" min={0} max={59}
        data-testid={testid ? `${testid}-m` : undefined}
        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={minutes}
        onChange={(e) => onChange(hmToMs(hours, Number(e.target.value)))}
      />
      <span className="text-xs text-gray-500">m</span>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/components/DurationField.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/components/DurationField.tsx packages/web/src/app/components/DurationField.test.tsx
git commit -m "feat(web): shared DurationField (h/m inputs over a ms value)"
```

---

## Task 5: `taskForm.ts` (pure)

**Files:**
- Create: `packages/web/src/app/tasks/taskForm.ts`
- Create: `packages/web/src/app/tasks/taskForm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { Task } from '../../api/types';
import { defaultQuickAddInput, toFormState, validateTaskForm, toUpdateInput, type TaskFormState } from './taskForm';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: 'work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<TaskFormState> = {}): TaskFormState => ({
  title: 'X', durationMs: 3_600_000, priority: 3, dueByLocal: '2026-06-01T17:00',
  minChunkMs: 1_800_000, maxChunkMs: 7_200_000, category: '', status: 'pending', ...over,
});

describe('taskForm', () => {
  it('defaultQuickAddInput uses smart defaults and the injected now', () => {
    const input = defaultQuickAddInput('  New task  ', NOW);
    expect(input).toEqual({
      title: 'New task', priority: 3, durationMs: 3_600_000,
      dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000, category: null,
    });
  });

  it('toFormState maps a Task (ISO due → local; category null → "")', () => {
    expect(toFormState(task())).toEqual({
      title: 'Write spec', durationMs: 5_400_000, priority: 2, dueByLocal: '2026-06-01T17:00',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, category: 'work', status: 'pending',
    });
    expect(toFormState(task({ category: null })).category).toBe('');
  });

  it('validateTaskForm flags empty title, non-positive durations, min>max, bad due', () => {
    expect(validateTaskForm(validState()).ok).toBe(true);
    expect(validateTaskForm(validState({ title: '   ' })).errors.title).toBeTruthy();
    expect(validateTaskForm(validState({ durationMs: 0 })).errors.durationMs).toBeTruthy();
    expect(validateTaskForm(validState({ minChunkMs: 8_000_000 })).errors.maxChunkMs).toBeTruthy();
    expect(validateTaskForm(validState({ dueByLocal: '' })).errors.dueByLocal).toBeTruthy();
  });

  it('toUpdateInput converts local due → ISO and "" category → null, includes status', () => {
    expect(toUpdateInput(validState({ category: '', status: 'scheduled' }))).toEqual({
      title: 'X', priority: 3, durationMs: 3_600_000, dueBy: '2026-06-01T17:00:00.000Z',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, category: null, status: 'scheduled',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts`
Expected: FAIL — `Cannot find module './taskForm'`.

- [ ] **Step 3: Create `src/app/tasks/taskForm.ts`**

```ts
import type { Task, TaskStatus, CreateTaskInput, UpdateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TaskFormState {
  title: string;
  durationMs: number;
  priority: number;
  dueByLocal: string;   // "YYYY-MM-DDTHH:MM"
  minChunkMs: number;
  maxChunkMs: number;
  category: string;     // '' => null
  status: TaskStatus;
}

export function defaultQuickAddInput(title: string, now: number): CreateTaskInput {
  return {
    title: title.trim(),
    priority: 3,
    durationMs: 60 * 60_000,
    dueBy: new Date(now + 7 * DAY_MS).toISOString(),
    minChunkMs: 30 * 60_000,
    maxChunkMs: 120 * 60_000,
    category: null,
  };
}

export function toFormState(t: Task): TaskFormState {
  return {
    title: t.title,
    durationMs: t.durationMs,
    priority: t.priority,
    dueByLocal: isoToLocalInput(t.dueBy),
    minChunkMs: t.minChunkMs,
    maxChunkMs: t.maxChunkMs,
    category: t.category ?? '',
    status: t.status,
  };
}

export type TaskFormErrors = Partial<Record<keyof TaskFormState, string>>;

export function validateTaskForm(s: TaskFormState): { ok: boolean; errors: TaskFormErrors } {
  const errors: TaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min chunk must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max chunk must be positive';
  else if (s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max chunk must be ≥ min chunk';
  if (!s.dueByLocal || Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'A valid due date is required';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toUpdateInput(s: TaskFormState): UpdateTaskInput {
  return {
    title: s.title.trim(),
    priority: s.priority,
    durationMs: s.durationMs,
    dueBy: localInputToIso(s.dueByLocal),
    minChunkMs: s.minChunkMs,
    maxChunkMs: s.maxChunkMs,
    category: s.category.trim() || null,
    status: s.status,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/tasks/taskForm.ts packages/web/src/app/tasks/taskForm.test.ts
git commit -m "feat(web): pure taskForm (defaults, validation, conversions)"
```

---

## Task 6: `TaskRow` component

**Files:**
- Create: `packages/web/src/app/tasks/TaskRow.tsx`
- Create: `packages/web/src/app/tasks/TaskRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../../api/types';
import { TaskRow } from './TaskRow';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: 'work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Partial<Task> = {}) {
  const onEdit = vi.fn(); const onComplete = vi.fn(); const onDelete = vi.fn();
  render(<TaskRow task={task(over)} onEdit={onEdit} onComplete={onComplete} onDelete={onDelete} />);
  return { onEdit, onComplete, onDelete };
}

describe('TaskRow', () => {
  it('renders title, category and duration/priority meta', () => {
    setup();
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('Write spec');
    expect(row).toHaveTextContent('work');
    expect(row).toHaveTextContent('1h');
    expect(row).toHaveTextContent('P2');
  });

  it('edit and complete fire their callbacks', () => {
    const { onEdit, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'complete' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('delete requires an inline confirm', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('completed task is struck through and has no complete button', () => {
    setup({ status: 'completed' });
    expect(screen.queryByRole('button', { name: 'complete' })).toBeNull();
    expect(screen.getByText('Write spec')).toHaveClass('line-through');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/tasks/TaskRow.test.tsx`
Expected: FAIL — `Cannot find module './TaskRow'`.

- [ ] **Step 3: Create `src/app/tasks/TaskRow.tsx`**

```tsx
import { useState } from 'react';
import type { Task } from '../../api/types';
import { formatDurationShort } from '../lib/duration';

export interface TaskRowProps {
  task: Task;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskRow({ task, onEdit, onComplete, onDelete }: TaskRowProps) {
  const [confirming, setConfirming] = useState(false);
  const completed = task.status === 'completed';
  const due = new Date(task.dueBy).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <div data-testid="task-row" className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm">
      <span className={`flex-1 font-medium ${completed ? 'text-gray-400 line-through' : ''}`}>{task.title}</span>
      {task.category && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-600">{task.category}</span>}
      <span className="text-xs text-gray-500">{formatDurationShort(task.durationMs)} · due {due} · P{task.priority}</span>
      {confirming ? (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Delete?</span>
          <button onClick={() => onDelete(task)} className="text-red-600">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-gray-600">Cancel</button>
        </span>
      ) : (
        <span className="flex gap-1">
          <button onClick={() => onEdit(task)} className="rounded border border-gray-200 px-1.5 text-xs">edit</button>
          {!completed && (
            <button aria-label="complete" onClick={() => onComplete(task)} className="rounded border border-gray-200 px-1.5 text-xs text-green-600">✓</button>
          )}
          <button aria-label="delete" onClick={() => setConfirming(true)} className="rounded border border-gray-200 px-1.5 text-xs text-red-600">×</button>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/tasks/TaskRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/tasks/TaskRow.tsx packages/web/src/app/tasks/TaskRow.test.tsx
git commit -m "feat(web): TaskRow with inline complete + confirm-delete"
```

---

## Task 7: `TaskDrawer` component

**Files:**
- Create: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Create: `packages/web/src/app/tasks/TaskDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { TaskDrawer } from './TaskDrawer';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: 'work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('TaskDrawer', () => {
  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    render(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />);
    expect((screen.getByTestId('duration-h') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('duration-m') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec', durationMs: 5_400_000, dueBy: '2026-06-01T17:00:00.000Z', category: 'work', status: 'pending' }));
  });

  it('blocks save and shows an error when min chunk > max chunk', () => {
    const onSave = vi.fn();
    render(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('minchunk-h'), { target: { value: '5' } }); // 5h min > 2h max
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-maxChunkMs')).toBeInTheDocument();
  });

  it('surfaces a mutation ApiError', () => {
    render(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} error={new ApiError(409, 'conflict', 'Nope')} />);
    expect(screen.getByTestId('drawer-error')).toHaveTextContent('Nope');
  });

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/tasks/TaskDrawer.test.tsx`
Expected: FAIL — `Cannot find module './TaskDrawer'`.

- [ ] **Step 3: Create `src/app/tasks/TaskDrawer.tsx`**

```tsx
import { useState } from 'react';
import type { Task, TaskStatus, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';

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
  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'w-full rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'mt-0.5 text-[11px] text-red-600';

  return (
    <aside data-testid="task-drawer" className="w-60 shrink-0 rounded-lg border-l-2 border-blue-500 bg-gray-50 p-3">
      <h4 className="mb-2 text-sm font-semibold">Edit task</h4>

      <div className="mb-2">
        <label className={labelCls}>Title</label>
        <input className={ctlCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
        {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Duration</label>
        <DurationField valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} testid="duration" />
        {errors.durationMs && <p data-testid="err-durationMs" className={errCls}>{errors.durationMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Priority (lower = scheduled first)</label>
        <input type="number" className={ctlCls} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
      </div>

      <div className="mb-2">
        <label className={labelCls}>Due by</label>
        <input type="datetime-local" className={ctlCls} value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} />
        {errors.dueByLocal && <p data-testid="err-dueByLocal" className={errCls}>{errors.dueByLocal}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Min chunk</label>
        <DurationField valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} testid="minchunk" />
      </div>
      <div className="mb-2">
        <label className={labelCls}>Max chunk</label>
        <DurationField valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} testid="maxchunk" />
        {errors.maxChunkMs && <p data-testid="err-maxChunkMs" className={errCls}>{errors.maxChunkMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Category</label>
        <input className={ctlCls} value={form.category} onChange={(e) => set('category', e.target.value)} />
      </div>

      <div className="mb-2">
        <label className={labelCls}>Status</label>
        <select className={ctlCls} value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <p data-testid="drawer-error" className={errCls}>{error.message}</p>}

      <div className="mt-2 flex gap-2">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1 text-sm">Cancel</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/tasks/TaskDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx
git commit -m "feat(web): TaskDrawer edit form with validation + ApiError surfacing"
```

---

## Task 8: `Tasks` page (integration)

**Files:**
- Modify: `packages/web/src/app/pages/Tasks.tsx` (replace placeholder)
- Create: `packages/web/src/app/pages/Tasks.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Tasks } from './Tasks';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function makeApi(over = {}) {
  return fakeApiClient({
    listTasks: vi.fn(async () => [task(), task({ id: 't2', title: 'Done thing', status: 'completed' })]),
    createTask: vi.fn(async () => task({ id: 't9' })),
    updateTask: vi.fn(async () => task()),
    deleteTask: vi.fn(async () => undefined),
    ...over,
  } as never);
}

describe('Tasks page', () => {
  it('lists active tasks by default and filters by tab', async () => {
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.queryByText('Done thing')).toBeNull(); // completed hidden under Active
    fireEvent.click(screen.getByTestId('tab-completed'));
    expect(screen.getByText('Done thing')).toBeInTheDocument();
    expect(screen.queryByText('Write spec')).toBeNull();
  });

  it('quick-add creates a task with defaults from injected now', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ createTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'New thing', durationMs: 3_600_000, dueBy: '2026-01-12T00:00:00.000Z' })));
  });

  it('completing a task calls updateTask with status completed', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'complete' })[0]!);
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('t1', { status: 'completed' }));
  });

  it('editing opens the drawer and saves', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'edit' })[0]!);
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(updateTask).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Tasks.test.tsx`
Expected: FAIL — the placeholder `Tasks` renders no rows and accepts no `now` prop.

- [ ] **Step 3: Replace `src/app/pages/Tasks.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Task, TaskStatus } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../tasks/TaskRow';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { defaultQuickAddInput } from '../tasks/taskForm';

type Tab = 'active' | 'completed' | 'archived' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];
function matchesTab(status: TaskStatus, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'active') return status === 'pending' || status === 'scheduled';
  return status === tab;
}

export function Tasks({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const createM = useCreateTaskMutation();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();
  const [tab, setTab] = useState<Tab>('active');
  const [editing, setEditing] = useState<Task | null>(null);

  const visible = useMemo(
    () => (tasksQ.data ?? []).filter((t) => matchesTab(t.status, tab)),
    [tasksQ.data, tab],
  );

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        <h2 className="mb-3 text-lg font-semibold">Tasks</h2>
        <QuickAdd placeholder="+ Add a task…" onAdd={(title) => createM.mutate(defaultQuickAddInput(title, now()))} />
        <div className="mb-2 flex gap-1 text-xs">
          {TABS.map((t) => (
            <button key={t.key} data-testid={`tab-${t.key}`} onClick={() => setTab(t.key)}
              className={`rounded-full border px-2 py-0.5 ${tab === t.key ? 'border-blue-200 bg-blue-100 font-medium text-blue-700' : 'border-gray-200 text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {tasksQ.isLoading && <div className="text-sm text-gray-500">Loading tasks…</div>}
        {tasksQ.isError && (
          <div className="text-sm">
            <span className="text-red-600">Couldn’t load tasks.</span>{' '}
            <button onClick={() => void tasksQ.refetch()} className="rounded border border-gray-300 px-2">Retry</button>
          </div>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && visible.length === 0 && (
          <p className="text-sm text-gray-500">No tasks here — add one above.</p>
        )}
        <div>
          {visible.map((t) => (
            <TaskRow key={t.id} task={t}
              onEdit={setEditing}
              onComplete={(task) => updateM.mutate({ id: task.id, patch: { status: 'completed' } })}
              onDelete={(task) => deleteM.mutate(task.id)} />
          ))}
        </div>
      </div>
      {editing && (
        <TaskDrawer task={editing} saving={updateM.isPending}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
          onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
```

Note: the complete button calls `updateTask(id, { status: 'completed' })` — the page passes `{ id, patch: { status: 'completed' } }` to the mutation, whose `mutationFn` calls `api.updateTask(id, patch)`, so the fake sees `updateTask('t1', { status: 'completed' })`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Tasks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full web suite + build**

Run: `npm test -w @notreclaim/web && npm run build -w @notreclaim/web`
Expected: all pass; build clean. (`App.test.tsx` does not navigate to `/tasks`, so it is unaffected by this task.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/pages/Tasks.tsx packages/web/src/app/pages/Tasks.test.tsx
git commit -m "feat(web): Tasks page — quick-add, status tabs, rows, edit drawer"
```

---

## Task 9: `habitForm.ts` (pure)

**Files:**
- Create: `packages/web/src/app/habits/habitForm.ts`
- Create: `packages/web/src/app/habits/habitForm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { Habit } from '../../api/types';
import { defaultQuickAddInput, toFormState, validateHabitForm, toUpdateInput, type HabitFormState } from './habitForm';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: 360, preferredEndMinute: 540, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<HabitFormState> = {}): HabitFormState => ({
  title: 'Run', chunkMs: 1_800_000, perPeriod: 4, priority: 3, eligibleDays: [1, 3, 5],
  preferredStart: '06:00', preferredEnd: '09:00', status: 'active', ...over,
});

describe('habitForm', () => {
  it('defaultQuickAddInput uses smart defaults (all 7 days, null window)', () => {
    expect(defaultQuickAddInput('  Meditate  ')).toEqual({
      title: 'Meditate', priority: 3, chunkMs: 1_800_000, perPeriod: 3,
      eligibleDays: [0, 1, 2, 3, 4, 5, 6], preferredStartMinute: null, preferredEndMinute: null,
    });
  });

  it('toFormState maps minutes → "HH:MM" and null window → ""', () => {
    expect(toFormState(habit())).toEqual({
      title: 'Run', chunkMs: 1_800_000, perPeriod: 4, priority: 2, eligibleDays: [1, 3, 5],
      preferredStart: '06:00', preferredEnd: '09:00', status: 'active',
    });
    const s = toFormState(habit({ preferredStartMinute: null, preferredEndMinute: null }));
    expect(s.preferredStart).toBe('');
    expect(s.preferredEnd).toBe('');
  });

  it('validateHabitForm flags empty title, non-positive chunk/perPeriod, zero days, start>=end', () => {
    expect(validateHabitForm(validState()).ok).toBe(true);
    expect(validateHabitForm(validState({ title: ' ' })).errors.title).toBeTruthy();
    expect(validateHabitForm(validState({ chunkMs: 0 })).errors.chunkMs).toBeTruthy();
    expect(validateHabitForm(validState({ perPeriod: 0 })).errors.perPeriod).toBeTruthy();
    expect(validateHabitForm(validState({ eligibleDays: [] })).errors.eligibleDays).toBeTruthy();
    expect(validateHabitForm(validState({ preferredStart: '10:00', preferredEnd: '09:00' })).errors.preferredEnd).toBeTruthy();
  });

  it('toUpdateInput converts "HH:MM" → minutes (or null) and includes status', () => {
    expect(toUpdateInput(validState({ preferredStart: '', preferredEnd: '', status: 'paused' }))).toEqual({
      title: 'Run', priority: 3, chunkMs: 1_800_000, perPeriod: 4, eligibleDays: [1, 3, 5],
      preferredStartMinute: null, preferredEndMinute: null, status: 'paused',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/habits/habitForm.test.ts`
Expected: FAIL — `Cannot find module './habitForm'`.

- [ ] **Step 3: Create `src/app/habits/habitForm.ts`**

```ts
import type { Habit, HabitStatus, CreateHabitInput, UpdateHabitInput } from '../../api/types';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

export interface HabitFormState {
  title: string;
  chunkMs: number;
  perPeriod: number;
  priority: number;
  eligibleDays: number[];   // 0..6
  preferredStart: string;   // "HH:MM" or ''
  preferredEnd: string;     // "HH:MM" or ''
  status: HabitStatus;
}

export function defaultQuickAddInput(title: string): CreateHabitInput {
  return {
    title: title.trim(),
    priority: 3,
    chunkMs: 30 * 60_000,
    perPeriod: 3,
    eligibleDays: [0, 1, 2, 3, 4, 5, 6],
    preferredStartMinute: null,
    preferredEndMinute: null,
  };
}

export function toFormState(h: Habit): HabitFormState {
  return {
    title: h.title,
    chunkMs: h.chunkMs,
    perPeriod: h.perPeriod,
    priority: h.priority,
    eligibleDays: [...h.eligibleDays],
    preferredStart: h.preferredStartMinute != null ? minutesToHHMM(h.preferredStartMinute) : '',
    preferredEnd: h.preferredEndMinute != null ? minutesToHHMM(h.preferredEndMinute) : '',
    status: h.status,
  };
}

export type HabitFormErrors = Partial<Record<keyof HabitFormState, string>>;

export function validateHabitForm(s: HabitFormState): { ok: boolean; errors: HabitFormErrors } {
  const errors: HabitFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.chunkMs > 0)) errors.chunkMs = 'Chunk must be positive';
  if (!(s.perPeriod > 0)) errors.perPeriod = 'Times per week must be positive';
  if (s.eligibleDays.length === 0) errors.eligibleDays = 'Pick at least one day';
  if (s.preferredStart && s.preferredEnd && hhmmToMinutes(s.preferredStart) >= hhmmToMinutes(s.preferredEnd)) {
    errors.preferredEnd = 'End must be after start';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toUpdateInput(s: HabitFormState): UpdateHabitInput {
  return {
    title: s.title.trim(),
    priority: s.priority,
    chunkMs: s.chunkMs,
    perPeriod: s.perPeriod,
    eligibleDays: s.eligibleDays,
    preferredStartMinute: s.preferredStart ? hhmmToMinutes(s.preferredStart) : null,
    preferredEndMinute: s.preferredEnd ? hhmmToMinutes(s.preferredEnd) : null,
    status: s.status,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/habits/habitForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/habits/habitForm.ts packages/web/src/app/habits/habitForm.test.ts
git commit -m "feat(web): pure habitForm (defaults, validation, conversions)"
```

---

## Task 10: `HabitRow` component

**Files:**
- Create: `packages/web/src/app/habits/HabitRow.tsx`
- Create: `packages/web/src/app/habits/HabitRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { HabitRow } from './HabitRow';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Partial<Habit> = {}) {
  const onEdit = vi.fn(); const onToggleStatus = vi.fn(); const onDelete = vi.fn();
  render(<HabitRow habit={habit(over)} onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />);
  return { onEdit, onToggleStatus, onDelete };
}

describe('HabitRow', () => {
  it('renders chunk × per-week and eligible days', () => {
    setup();
    const row = screen.getByTestId('habit-row');
    expect(row).toHaveTextContent('Run');
    expect(row).toHaveTextContent('30m × 4/week');
    expect(row).toHaveTextContent('Mon');
  });

  it('pause toggles status (active → resume label when paused)', () => {
    const { onToggleStatus } = setup();
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
  });

  it('shows resume for a paused habit', () => {
    setup({ status: 'paused' });
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
  });

  it('delete requires inline confirm', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/habits/HabitRow.test.tsx`
Expected: FAIL — `Cannot find module './HabitRow'`.

- [ ] **Step 3: Create `src/app/habits/HabitRow.tsx`**

```tsx
import { useState } from 'react';
import type { Habit } from '../../api/types';
import { formatDurationShort } from '../lib/duration';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface HabitRowProps {
  habit: Habit;
  onEdit: (habit: Habit) => void;
  onToggleStatus: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}

export function HabitRow({ habit, onEdit, onToggleStatus, onDelete }: HabitRowProps) {
  const [confirming, setConfirming] = useState(false);
  const paused = habit.status === 'paused';
  const days = [...habit.eligibleDays].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' ');
  return (
    <div data-testid="habit-row" className={`flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm ${paused ? 'opacity-60' : ''}`}>
      <span className="flex-1 font-medium">{habit.title}</span>
      <span className="text-xs text-gray-500">{formatDurationShort(habit.chunkMs)} × {habit.perPeriod}/week · {days}</span>
      {confirming ? (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Delete?</span>
          <button onClick={() => onDelete(habit)} className="text-red-600">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-gray-600">Cancel</button>
        </span>
      ) : (
        <span className="flex gap-1">
          <button onClick={() => onEdit(habit)} className="rounded border border-gray-200 px-1.5 text-xs">edit</button>
          <button onClick={() => onToggleStatus(habit)} className="rounded border border-gray-200 px-1.5 text-xs">{paused ? 'resume' : 'pause'}</button>
          <button aria-label="delete" onClick={() => setConfirming(true)} className="rounded border border-gray-200 px-1.5 text-xs text-red-600">×</button>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/habits/HabitRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/habits/HabitRow.tsx packages/web/src/app/habits/HabitRow.test.tsx
git commit -m "feat(web): HabitRow with pause/resume + confirm-delete"
```

---

## Task 11: `HabitDrawer` component

**Files:**
- Create: `packages/web/src/app/habits/HabitDrawer.tsx`
- Create: `packages/web/src/app/habits/HabitDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { HabitDrawer } from './HabitDrawer';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('HabitDrawer', () => {
  it('prefills and saves a converted patch', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit()} onSave={onSave} onCancel={vi.fn()} />);
    expect((screen.getByTestId('chunk-h') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('chunk-m') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Run', chunkMs: 1_800_000, perPeriod: 4, eligibleDays: [1, 3, 5], status: 'active' }));
  });

  it('toggling a day updates eligibleDays', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-0')); // add Sunday
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ eligibleDays: expect.arrayContaining([0, 1, 3, 5]) }));
  });

  it('blocks save when no day is selected', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit({ eligibleDays: [1] })} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-1')); // remove the only day
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-eligibleDays')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/habits/HabitDrawer.test.tsx`
Expected: FAIL — `Cannot find module './HabitDrawer'`.

- [ ] **Step 3: Create `src/app/habits/HabitDrawer.tsx`**

```tsx
import { useState } from 'react';
import type { Habit, HabitStatus, UpdateHabitInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import { type HabitFormState, toFormState, validateHabitForm, toUpdateInput } from './habitForm';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const STATUSES: HabitStatus[] = ['active', 'paused'];

export interface HabitDrawerProps {
  habit: Habit;
  onSave: (patch: UpdateHabitInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
}

export function HabitDrawer({ habit, onSave, onCancel, saving = false, error = null }: HabitDrawerProps) {
  const [form, setForm] = useState<HabitFormState>(() => toFormState(habit));
  const { ok, errors } = validateHabitForm(form);
  const set = <K extends keyof HabitFormState>(k: K, v: HabitFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, eligibleDays: f.eligibleDays.includes(d) ? f.eligibleDays.filter((x) => x !== d) : [...f.eligibleDays, d] }));
  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'w-full rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'mt-0.5 text-[11px] text-red-600';

  return (
    <aside data-testid="habit-drawer" className="w-60 shrink-0 rounded-lg border-l-2 border-blue-500 bg-gray-50 p-3">
      <h4 className="mb-2 text-sm font-semibold">Edit habit</h4>

      <div className="mb-2">
        <label className={labelCls}>Title</label>
        <input className={ctlCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
        {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Chunk</label>
        <DurationField valueMs={form.chunkMs} onChange={(ms) => set('chunkMs', ms)} testid="chunk" />
        {errors.chunkMs && <p data-testid="err-chunkMs" className={errCls}>{errors.chunkMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Times per week</label>
        <input type="number" min={1} className={ctlCls} value={form.perPeriod} onChange={(e) => set('perPeriod', Number(e.target.value))} />
        {errors.perPeriod && <p data-testid="err-perPeriod" className={errCls}>{errors.perPeriod}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Eligible days</label>
        <div className="flex gap-1">
          {DAY_LABELS.map((lbl, d) => (
            <button key={d} data-testid={`day-${d}`} onClick={() => toggleDay(d)}
              className={`w-6 rounded border py-0.5 text-[10px] ${form.eligibleDays.includes(d) ? 'border-green-300 bg-green-100 font-semibold text-green-800' : 'border-gray-300 text-gray-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
        {errors.eligibleDays && <p data-testid="err-eligibleDays" className={errCls}>{errors.eligibleDays}</p>}
      </div>

      <div className="mb-2 flex gap-2">
        <div className="flex-1">
          <label className={labelCls}>Preferred from</label>
          <input type="time" className={ctlCls} value={form.preferredStart} onChange={(e) => set('preferredStart', e.target.value)} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>to</label>
          <input type="time" className={ctlCls} value={form.preferredEnd} onChange={(e) => set('preferredEnd', e.target.value)} />
        </div>
      </div>
      {errors.preferredEnd && <p data-testid="err-preferredEnd" className={errCls}>{errors.preferredEnd}</p>}

      <div className="mb-2 flex gap-2">
        <div className="flex-1">
          <label className={labelCls}>Priority</label>
          <input type="number" className={ctlCls} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Status</label>
          <select className={ctlCls} value={form.status} onChange={(e) => set('status', e.target.value as HabitStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <p data-testid="drawer-error" className={errCls}>{error.message}</p>}

      <div className="mt-2 flex gap-2">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1 text-sm">Cancel</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/habits/HabitDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/habits/HabitDrawer.tsx packages/web/src/app/habits/HabitDrawer.test.tsx
git commit -m "feat(web): HabitDrawer edit form (day toggles, preferred window, validation)"
```

---

## Task 12: `Habits` page (integration) + fix `App.test.tsx`

**Files:**
- Modify: `packages/web/src/app/pages/Habits.tsx` (replace placeholder)
- Create: `packages/web/src/app/pages/Habits.test.tsx`
- Modify: `packages/web/src/app/App.test.tsx`

- [ ] **Step 1: Write the failing test `src/app/pages/Habits.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Habits } from './Habits';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function makeApi(over = {}) {
  return fakeApiClient({
    listHabits: vi.fn(async () => [habit()]),
    createHabit: vi.fn(async () => habit({ id: 'h9' })),
    updateHabit: vi.fn(async () => habit()),
    deleteHabit: vi.fn(async () => undefined),
    ...over,
  } as never);
}

describe('Habits page', () => {
  it('lists habits', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
  });

  it('quick-add creates a habit with defaults', async () => {
    const createHabit = vi.fn(async () => habit({ id: 'h9' }));
    renderWithProviders(<Habits />, { api: makeApi({ createHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a habit/i), { target: { value: 'Meditate' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a habit/i), { key: 'Enter' });
    await waitFor(() => expect(createHabit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meditate', perPeriod: 3, eligibleDays: [0, 1, 2, 3, 4, 5, 6] })));
  });

  it('pause toggles status via updateHabit', async () => {
    const updateHabit = vi.fn(async () => habit());
    renderWithProviders(<Habits />, { api: makeApi({ updateHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    await waitFor(() => expect(updateHabit).toHaveBeenCalledWith('h1', { status: 'paused' }));
  });

  it('delete confirm calls deleteHabit', async () => {
    const deleteHabit = vi.fn(async () => undefined);
    renderWithProviders(<Habits />, { api: makeApi({ deleteHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    await waitFor(() => expect(deleteHabit).toHaveBeenCalledWith('h1'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Habits.test.tsx`
Expected: FAIL — the placeholder `Habits` renders no rows.

- [ ] **Step 3: Replace `src/app/pages/Habits.tsx`**

```tsx
import { useState } from 'react';
import type { Habit } from '../../api/types';
import { ApiError } from '../../api/client';
import { useHabitsQuery, useCreateHabitMutation, useUpdateHabitMutation, useDeleteHabitMutation } from '../../api/queries';
import { QuickAdd } from '../components/QuickAdd';
import { HabitRow } from '../habits/HabitRow';
import { HabitDrawer } from '../habits/HabitDrawer';
import { defaultQuickAddInput } from '../habits/habitForm';

export function Habits() {
  const habitsQ = useHabitsQuery();
  const createM = useCreateHabitMutation();
  const updateM = useUpdateHabitMutation();
  const deleteM = useDeleteHabitMutation();
  const [editing, setEditing] = useState<Habit | null>(null);

  const habits = habitsQ.data ?? [];

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        <h2 className="mb-3 text-lg font-semibold">Habits</h2>
        <QuickAdd placeholder="+ Add a habit…" onAdd={(title) => createM.mutate(defaultQuickAddInput(title))} />
        {habitsQ.isLoading && <div className="text-sm text-gray-500">Loading habits…</div>}
        {habitsQ.isError && (
          <div className="text-sm">
            <span className="text-red-600">Couldn’t load habits.</span>{' '}
            <button onClick={() => void habitsQ.refetch()} className="rounded border border-gray-300 px-2">Retry</button>
          </div>
        )}
        {!habitsQ.isLoading && !habitsQ.isError && habits.length === 0 && (
          <p className="text-sm text-gray-500">No habits yet — add one above.</p>
        )}
        <div>
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h}
              onEdit={setEditing}
              onToggleStatus={(habit) => updateM.mutate({ id: habit.id, patch: { status: habit.status === 'active' ? 'paused' : 'active' } })}
              onDelete={(habit) => deleteM.mutate(habit.id)} />
          ))}
        </div>
      </div>
      {editing && (
        <HabitDrawer habit={editing} saving={updateM.isPending}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
          onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Habits.test.tsx`
Expected: PASS.

- [ ] **Step 5: Fix `App.test.tsx` (the Habits-nav assertion now breaks)**

`App.test.tsx`'s "navigates to the Habits page" test asserts the placeholder copy `/arrives in 5c/i`, which no longer exists; and navigating now triggers `listHabits()`/`listTasks()` fetches. Update the `authedApi()` stub to also return empty lists, and change the assertion to target a stable element (the Habits quick-add input):

Replace the `authedApi()` helper body with:

```ts
function authedApi() {
  return fakeApiClient({
    getSchedule: async () => [],
    getCalendarEvents: async () => [],
    getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
    listTasks: async () => [],
    listHabits: async () => [],
  } as never);
}
```

Replace the assertion line in the "navigates to the Habits page via the sidebar" test:

```ts
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
```

(Leave the other three tests unchanged.)

- [ ] **Step 6: Run the App tests + full web suite + build**

Run: `npm test -w @notreclaim/web && npm run build -w @notreclaim/web`
Expected: all pass (App 4/4, no `act()` warnings), build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/pages/Habits.tsx packages/web/src/app/pages/Habits.test.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): Habits page — quick-add, rows, pause/resume, edit drawer"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire monorepo test suite**

Ensure the userspace Postgres is running (the `@notreclaim/db` setup runs `prisma migrate deploy`):
```bash
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata status >/dev/null 2>&1 || \
  /usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start
```
Run: `npm test`
Expected: every package passes with **zero failures**. Baselines before 5c: core 27, scheduler 31, google 33, db 35, server 56, web 56. After 5c, web grows by the new suites (duration, QuickAdd, DurationField, taskForm, TaskRow, TaskDrawer, Tasks, habitForm, HabitRow, HabitDrawer, Habits, plus the queries additions). The only requirement is no failures across all six packages.

- [ ] **Step 2: Typecheck/build the web package**

Run: `npm run build -w @notreclaim/web`
Expected: clean (`tsc -p tsconfig.json` typechecks test files, then `vite build`).

- [ ] **Step 3: Commit any build-driven fixes (only if needed)**

```bash
git add -A
git commit -m "chore(web): typecheck fixes for 5c"
```

(Skip if the build was already clean.)

---

## Notes for the implementer

- **`fakeApiClient` overrides:** pass `{ ...methods } as never` (matches the 5a/5b pattern) — the partial-override variance otherwise complains.
- **Creation is quick-add only.** The drawers are **edit-only** (always initialized from an existing `Task`/`Habit` via `toFormState`). There is no create-via-drawer path; this keeps the forms initialized from real data and matches the locked create-flow decision.
- **`updateTask`/`updateHabit` fake call shape:** the page passes `{ id, patch }` to the mutation; the mutation's `mutationFn` calls `api.updateTask(id, patch)` — so test spies see `updateTask('t1', { status: 'completed' })` (two args), not the object.
- **`now` injection:** only the `Tasks` page needs `now` (for the quick-add `dueBy` default). `Habits` has no due date, so no `now` prop.
- **No `Date.now()` in pure modules.** `taskForm.defaultQuickAddInput(title, now)` takes `now`; the `Tasks` page supplies `now()` at the call site.
- **Determinism:** web tests run under `TZ=UTC` (already pinned in `package.json`); `datetime-local`/local-time conversions and the `dueBy` default are deterministic there.
- **Day order in `HabitRow`:** eligible days are sorted ascending before labeling so the display is stable regardless of input order.
