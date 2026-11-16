import type { CreateTaskInput, Task, UpdateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';
import { MS_PER_DAY } from '../lib/time';

/** The fields shared by the task edit drawer and the new-task modal. */
export interface TaskFormState {
  title: string;
  durationMs: number;
  dueByLocal: string;   // "YYYY-MM-DDTHH:MM"
  notBeforeLocal: string;   // "YYYY-MM-DDTHH:MM"
  minChunkMs: number;
  maxChunkMs: number;
  categoryId: string | null;
}

/** The new-task modal adds a priority and a "Split up" toggle to the shared fields. */
export interface NewTaskFormState extends TaskFormState {
  priority: number;
  split: boolean;
}

export type TaskFormErrors = Partial<Record<keyof TaskFormState, string>>;

/**
 * Shared validation. `checkChunkOrder` gates the min ≤ max rule: the create form only applies it
 * when splitting, because unsplit chunks collapse to the duration.
 */
function validateFields(s: TaskFormState, checkChunkOrder: boolean): { ok: boolean; errors: TaskFormErrors } {
  const errors: TaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min chunk must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max chunk must be positive';
  else if (checkChunkOrder && s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max chunk must be ≥ min chunk';
  if (s.dueByLocal && Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'Enter a valid due date or leave it empty';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Shared fields → API input (empty date fields become null). */
function toTaskInput(s: TaskFormState) {
  return {
    title: s.title.trim(),
    durationMs: s.durationMs,
    dueBy: s.dueByLocal ? localInputToIso(s.dueByLocal) : null,
    notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null,
    minChunkMs: s.minChunkMs,
    maxChunkMs: s.maxChunkMs,
    categoryId: s.categoryId,
  };
}

// ── Edit form (TaskDrawer) ──

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

export function validateTaskForm(s: TaskFormState): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, true);
}

export function toUpdateInput(s: TaskFormState): UpdateTaskInput {
  return toTaskInput(s);
}

// ── Create form (NewTaskModal) ──

/** Local-time datetime-local string for the day of `ms` at hh:mm. */
function atLocalTime(ms: number, hours: number, minutes: number): string {
  const d = new Date(ms);
  d.setHours(hours, minutes, 0, 0);
  return isoToLocalInput(d.toISOString());
}

export function defaultNewTaskForm(
  now: number,
  settings?: { defaultMinChunkMs: number; defaultMaxChunkMs: number },
): NewTaskFormState {
  return {
    title: '',
    priority: 4,
    durationMs: 60 * 60_000,
    split: true,
    minChunkMs: settings?.defaultMinChunkMs ?? 30 * 60_000,
    maxChunkMs: settings?.defaultMaxChunkMs ?? 120 * 60_000,
    dueByLocal: atLocalTime(now + 7 * MS_PER_DAY, 23, 59),
    notBeforeLocal: atLocalTime(now, 8, 0),
    categoryId: null,
  };
}

export function validateNewTaskForm(s: NewTaskFormState): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, s.split);
}

export function toCreateTaskInput(s: NewTaskFormState): CreateTaskInput {
  // Unsplit tasks are scheduled as one chunk: min = max = duration.
  const chunks = s.split ? {} : { minChunkMs: s.durationMs, maxChunkMs: s.durationMs };
  return { ...toTaskInput({ ...s, ...chunks }), priority: s.priority };
}
