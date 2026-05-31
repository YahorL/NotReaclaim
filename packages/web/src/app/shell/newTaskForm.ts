import type { CreateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewTaskFormState {
  title: string;
  durationMs: number;
  split: boolean;
  minChunkMs: number;
  maxChunkMs: number;
  dueByLocal: string; // "YYYY-MM-DDTHH:MM"
}

export function defaultNewTaskForm(
  now: number,
  settings?: { defaultMinChunkMs: number; defaultMaxChunkMs: number },
): NewTaskFormState {
  return {
    title: '',
    durationMs: 60 * 60_000,
    split: true,
    minChunkMs: settings?.defaultMinChunkMs ?? 30 * 60_000,
    maxChunkMs: settings?.defaultMaxChunkMs ?? 120 * 60_000,
    dueByLocal: isoToLocalInput(new Date(now + 7 * DAY_MS).toISOString()),
  };
}

export type NewTaskFormErrors = Partial<Record<keyof NewTaskFormState, string>>;

export function validateNewTaskForm(s: NewTaskFormState): { ok: boolean; errors: NewTaskFormErrors } {
  const errors: NewTaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Task name is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max must be positive';
  else if (s.split && s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max must be ≥ min';
  if (!s.dueByLocal || Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'A valid due date is required';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toCreateTaskInput(s: NewTaskFormState): CreateTaskInput {
  const minChunkMs = s.split ? s.minChunkMs : s.durationMs;
  const maxChunkMs = s.split ? s.maxChunkMs : s.durationMs;
  return {
    title: s.title.trim(),
    priority: 4,
    durationMs: s.durationMs,
    dueBy: localInputToIso(s.dueByLocal),
    minChunkMs,
    maxChunkMs,
    category: null,
  };
}
