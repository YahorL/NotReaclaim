import type { CreateTaskInput, Task, UpdateTaskInput } from '../../api/types';
import { isoToZonedInput, zonedDayAtInput, zonedInputToIso } from '../lib/datetimeLocal';

/**
 * The fields shared by the task edit drawer and the new-task modal. The date fields are wall-clock
 * "YYYY-MM-DDTHH:MM" strings in the user's settings zone — every function that reads or writes
 * them takes that `zone`.
 */
export interface TaskFormState {
  title: string;
  durationMs: number;
  dueByLocal: string;
  notBeforeLocal: string;
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
 * A wall-clock date field read in `zone`: empty → null (the field's "no value" — no deadline, no
 * schedule-after); otherwise its ISO instant, or `undefined` when it does not convert (unparseable,
 * or a zone this browser's Intl does not know). `undefined` is a validation error, never a value.
 */
export function dateFieldToIso(local: string, zone: string): string | null | undefined {
  if (!local) return null;
  return zonedInputToIso(local, zone) ?? undefined;
}

/**
 * Shared validation. `checkChunkOrder` gates the min ≤ max rule: the create form only applies it
 * when splitting, because unsplit chunks collapse to the duration. Both date fields are checked in
 * `zone`, the zone the payload builders convert them in.
 */
function validateFields(s: TaskFormState, checkChunkOrder: boolean, zone: string): { ok: boolean; errors: TaskFormErrors } {
  const errors: TaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Title is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min chunk must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max chunk must be positive';
  else if (checkChunkOrder && s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max chunk must be ≥ min chunk';
  if (dateFieldToIso(s.dueByLocal, zone) === undefined) errors.dueByLocal = 'Enter a valid due date or leave it empty';
  if (dateFieldToIso(s.notBeforeLocal, zone) === undefined) errors.notBeforeLocal = 'Enter a valid date or leave it empty';
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Date field → payload value. Callers validate first, so a field that does not convert here is a
 * bug: throw rather than let it travel as null, which the server reads as "clear the value".
 */
function fieldToIso(local: string, zone: string): string | null {
  const iso = dateFieldToIso(local, zone);
  if (iso === undefined) throw new Error(`date field "${local}" does not convert in ${zone}; validate the form before building its payload`);
  return iso;
}

/** Shared fields → API input (empty date fields become null). */
function toTaskInput(s: TaskFormState, zone: string) {
  return {
    title: s.title.trim(),
    durationMs: s.durationMs,
    dueBy: fieldToIso(s.dueByLocal, zone),
    notBefore: fieldToIso(s.notBeforeLocal, zone),
    minChunkMs: s.minChunkMs,
    maxChunkMs: s.maxChunkMs,
    categoryId: s.categoryId,
  };
}

// ── Edit form (TaskDrawer) ──

export function toFormState(t: Task, zone: string): TaskFormState {
  return {
    title: t.title,
    durationMs: t.durationMs,
    dueByLocal: t.dueBy ? isoToZonedInput(t.dueBy, zone) : '',
    notBeforeLocal: t.notBefore ? isoToZonedInput(t.notBefore, zone) : '',
    minChunkMs: t.minChunkMs,
    maxChunkMs: t.maxChunkMs,
    categoryId: t.categoryId,
  };
}

export function validateTaskForm(s: TaskFormState, zone: string): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, true, zone);
}

export function toUpdateInput(s: TaskFormState, zone: string): UpdateTaskInput {
  return toTaskInput(s, zone);
}

/**
 * An unsplit task is scheduled as one chunk the size of the task, stored as min = max = duration
 * (`toCreateTaskInput`); there is no separate flag, so this shape IS the flag.
 */
export function isUnsplit(t: Pick<Task, 'durationMs' | 'minChunkMs' | 'maxChunkMs'>): boolean {
  return t.minChunkMs === t.durationMs && t.maxChunkMs === t.durationMs;
}

/**
 * Set the duration. With `chunksFollow` (the task was loaded unsplit and the user has not touched
 * min or max since), min and max move with it so the task stays unsplit; otherwise only the
 * duration changes.
 */
export function withDuration<S extends TaskFormState>(form: S, durationMs: number, chunksFollow: boolean): S {
  return chunksFollow
    ? { ...form, durationMs, minChunkMs: durationMs, maxChunkMs: durationMs }
    : { ...form, durationMs };
}

type DateFields = Pick<TaskFormState, 'dueByLocal' | 'notBeforeLocal'>;

/**
 * Re-seed after the zone changed (settings landing after the form opened in the fallback zone):
 * a date field still equal to its seed in the old zone takes its seed in the new one; a field the
 * user already edited keeps the typed wall-clock, which is then read in the new zone on submit.
 */
export function reseedDateFields<S extends DateFields>(form: S, prevSeed: DateFields, nextSeed: DateFields): S {
  return {
    ...form,
    dueByLocal: form.dueByLocal === prevSeed.dueByLocal ? nextSeed.dueByLocal : form.dueByLocal,
    notBeforeLocal: form.notBeforeLocal === prevSeed.notBeforeLocal ? nextSeed.notBeforeLocal : form.notBeforeLocal,
  };
}

// ── Create form (NewTaskModal) ──

/** Days ahead of today the default due date falls (at 23:59) — shared by the modal and the planner popover. */
export const DEFAULT_DUE_DAYS = 7;

/**
 * Default due date: 23:59 on the day `DEFAULT_DUE_DAYS` after today in `zone`, or on the day
 * containing `notBeforeMs` when that is later (the popover passes its slot so a pinned task is
 * never due before it).
 */
export function defaultDueLocal(now: number, zone: string, notBeforeMs?: number): string {
  return zonedDayAtInput(now, zone, DEFAULT_DUE_DAYS, 23, 59, notBeforeMs);
}

type ChunkFields = Pick<TaskFormState, 'minChunkMs' | 'maxChunkMs'>;
type ChunkDefaults = { defaultMinChunkMs: number; defaultMaxChunkMs: number };

/** The chunk sizes a new task starts with: the user's settings defaults, else a built-in 30 / 120 min. */
export function chunkSeed(settings?: ChunkDefaults): ChunkFields {
  return {
    minChunkMs: settings?.defaultMinChunkMs ?? 30 * 60_000,
    maxChunkMs: settings?.defaultMaxChunkMs ?? 120 * 60_000,
  };
}

/**
 * Re-seed after the chunk defaults changed (settings landing after the form opened on the
 * fallback): a chunk field still equal to its previous seed takes the new one; a field the user
 * already edited keeps its value. Same rule as `reseedDateFields`.
 */
export function reseedChunkFields<S extends ChunkFields>(form: S, prevSeed: ChunkFields, nextSeed: ChunkFields): S {
  return {
    ...form,
    minChunkMs: form.minChunkMs === prevSeed.minChunkMs ? nextSeed.minChunkMs : form.minChunkMs,
    maxChunkMs: form.maxChunkMs === prevSeed.maxChunkMs ? nextSeed.maxChunkMs : form.maxChunkMs,
  };
}

export function defaultNewTaskForm(now: number, zone: string, settings?: ChunkDefaults): NewTaskFormState {
  return {
    title: '',
    priority: 4,
    durationMs: 60 * 60_000,
    split: true,
    ...chunkSeed(settings),
    dueByLocal: defaultDueLocal(now, zone),
    notBeforeLocal: zonedDayAtInput(now, zone, 0, 8, 0),
    categoryId: null,
  };
}

export function validateNewTaskForm(s: NewTaskFormState, zone: string): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, s.split, zone);
}

export function toCreateTaskInput(s: NewTaskFormState, zone: string): CreateTaskInput {
  // Unsplit tasks are scheduled as one chunk: min = max = duration.
  const chunks = s.split ? {} : { minChunkMs: s.durationMs, maxChunkMs: s.durationMs };
  return { ...toTaskInput({ ...s, ...chunks }, zone), priority: s.priority };
}
