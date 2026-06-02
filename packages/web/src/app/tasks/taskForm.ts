import type { Task, TaskStatus, CreateTaskInput, UpdateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TaskFormState {
  title: string;
  durationMs: number;
  priority: number;
  dueByLocal: string;   // "YYYY-MM-DDTHH:MM"
  notBeforeLocal: string;   // "YYYY-MM-DDTHH:MM"
  minChunkMs: number;
  maxChunkMs: number;
  categoryId: string | null;
  status: TaskStatus;
}

export function defaultQuickAddInput(
  title: string,
  now: number,
  defaults?: { minChunkMs: number; maxChunkMs: number },
): CreateTaskInput {
  return {
    title: title.trim(),
    priority: 3,
    durationMs: 60 * 60_000,
    dueBy: new Date(now + 7 * DAY_MS).toISOString(),
    minChunkMs: defaults?.minChunkMs ?? 30 * 60_000,
    maxChunkMs: defaults?.maxChunkMs ?? 120 * 60_000,
    categoryId: null,
    notBefore: null,
  };
}

export function toFormState(t: Task): TaskFormState {
  return {
    title: t.title,
    durationMs: t.durationMs,
    priority: t.priority,
    dueByLocal: isoToLocalInput(t.dueBy),
    notBeforeLocal: t.notBefore ? isoToLocalInput(t.notBefore) : '',
    minChunkMs: t.minChunkMs,
    maxChunkMs: t.maxChunkMs,
    categoryId: t.categoryId,
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
    notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null,
    minChunkMs: s.minChunkMs,
    maxChunkMs: s.maxChunkMs,
    categoryId: s.categoryId,
    status: s.status,
  };
}
