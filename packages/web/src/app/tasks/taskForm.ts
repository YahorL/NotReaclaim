import type { CreateTaskInput, Task, UpdateTaskInput } from '../../api/types';
import { isoToZonedInput, isValidLocalInput, zonedDayAtInput, zonedInputToIso } from '../lib/datetimeLocal';

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
  if (s.dueByLocal && !isValidLocalInput(s.dueByLocal)) errors.dueByLocal = 'Enter a valid due date or leave it empty';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Wall-clock field in `zone` → ISO instant; empty (or unparseable) → null. */
function fieldToIso(local: string, zone: string): string | null {
  return local ? zonedInputToIso(local, zone) : null;
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

export function validateTaskForm(s: TaskFormState): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, true);
}

export function toUpdateInput(s: TaskFormState, zone: string): UpdateTaskInput {
  return toTaskInput(s, zone);
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

export function validateNewTaskForm(s: NewTaskFormState): { ok: boolean; errors: TaskFormErrors } {
  return validateFields(s, s.split);
}

export function toCreateTaskInput(s: NewTaskFormState, zone: string): CreateTaskInput {
  // Unsplit tasks are scheduled as one chunk: min = max = duration.
  const chunks = s.split ? {} : { minChunkMs: s.durationMs, maxChunkMs: s.durationMs };
  return { ...toTaskInput({ ...s, ...chunks }, zone), priority: s.priority };
}
