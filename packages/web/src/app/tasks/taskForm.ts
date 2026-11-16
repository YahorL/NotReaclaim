import type { Task, UpdateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';

export interface TaskFormState {
  title: string;
  durationMs: number;
  dueByLocal: string;   // "YYYY-MM-DDTHH:MM"
  notBeforeLocal: string;   // "YYYY-MM-DDTHH:MM"
  minChunkMs: number;
  maxChunkMs: number;
  categoryId: string | null;
}

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

export type TaskFormErrors = Partial<Record<keyof TaskFormState, string>>;

export function validateTaskForm(s: TaskFormState): { ok: boolean; errors: TaskFormErrors } {
  const errors: TaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min chunk must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max chunk must be positive';
  else if (s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max chunk must be ≥ min chunk';
  if (s.dueByLocal && Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'Enter a valid due date or leave it empty';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toUpdateInput(s: TaskFormState): UpdateTaskInput {
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
