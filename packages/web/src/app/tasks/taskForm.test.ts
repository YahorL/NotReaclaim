import { describe, it, expect } from 'vitest';
import type { Task } from '../../api/types';
import { toFormState, validateTaskForm, toUpdateInput, type TaskFormState } from './taskForm';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', completedAt: null, timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<TaskFormState> = {}): TaskFormState => ({
  title: 'X', durationMs: 3_600_000, dueByLocal: '2026-06-01T17:00',
  notBeforeLocal: '',
  minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null, ...over,
});

describe('taskForm', () => {
  it('toFormState maps a Task (ISO due → local; categoryId passthrough)', () => {
    expect(toFormState(task(), 'UTC')).toEqual({
      title: 'Write spec', durationMs: 5_400_000, dueByLocal: '2026-06-01T17:00',
      notBeforeLocal: '',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work',
    });
    expect(toFormState(task({ categoryId: null }), 'UTC').categoryId).toBeNull();
  });

  it('validateTaskForm flags empty title, non-positive durations, min>max, bad due', () => {
    expect(validateTaskForm(validState()).ok).toBe(true);
    expect(validateTaskForm(validState({ title: '   ' })).errors.title).toBeTruthy();
    expect(validateTaskForm(validState({ durationMs: 0 })).errors.durationMs).toBeTruthy();
    expect(validateTaskForm(validState({ minChunkMs: 8_000_000 })).errors.maxChunkMs).toBeTruthy();
    expect(validateTaskForm(validState({ dueByLocal: 'not-a-date' })).errors.dueByLocal).toBeTruthy();
  });

  it('accepts an empty due date', () => {
    const s = validState({ dueByLocal: '' });
    expect(validateTaskForm(s).ok).toBe(true);
    expect(validateTaskForm(s).errors.dueByLocal).toBeUndefined();
  });

  it('emits a null dueBy for an empty due date', () => {
    expect(toUpdateInput(validState({ dueByLocal: '' }), 'UTC').dueBy).toBeNull();
  });

  it('still rejects an unparseable due date', () => {
    expect(validateTaskForm(validState({ dueByLocal: 'not-a-date' })).ok).toBe(false);
  });

  it('maps a null dueBy back to an empty field', () => {
    expect(toFormState(task({ dueBy: null }), 'UTC').dueByLocal).toBe('');
  });

  it('toUpdateInput converts local due → ISO and passes categoryId (no status)', () => {
    expect(toUpdateInput(validState({ categoryId: null }), 'UTC')).toEqual({
      title: 'X', durationMs: 3_600_000, dueBy: '2026-06-01T17:00:00.000Z',
      notBefore: null,
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null,
    });
  });

  it('round-trips categoryId through the edit form', () => {
    const state = toFormState(task({ categoryId: 'cat-7' }), 'UTC');
    expect(state.categoryId).toBe('cat-7');
    expect(toUpdateInput(state, 'UTC').categoryId).toBe('cat-7');
  });

  it('round-trips notBefore through the edit form', () => {
    const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: null, notBefore: '2026-01-06T13:00:00.000Z', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
    const state = toFormState(task as never, 'UTC');
    expect(state.notBeforeLocal).not.toBe('');
    expect(toUpdateInput(state, 'UTC').notBefore).toBe(new Date(state.notBeforeLocal).toISOString());
    expect(toUpdateInput({ ...state, notBeforeLocal: '' }, 'UTC').notBefore).toBeNull();
  });
});

describe('taskForm in the settings zone', () => {
  it('toFormState reads ISO dates as wall-clock in the settings zone (New York, EDT)', () => {
    const s = toFormState(task({ notBefore: '2026-06-01T02:30:00.000Z' } as Partial<Task>), 'America/New_York');
    expect(s.dueByLocal).toBe('2026-06-01T13:00');
    expect(s.notBeforeLocal).toBe('2026-05-31T22:30');
  });

  it('toFormState crosses the date line east of UTC (Auckland)', () => {
    expect(toFormState(task(), 'Pacific/Auckland').dueByLocal).toBe('2026-06-02T05:00');
  });

  it('toUpdateInput interprets wall-clock fields in the settings zone', () => {
    const out = toUpdateInput(validState({ notBeforeLocal: '2026-06-01T08:00' }), 'America/New_York');
    expect(out.dueBy).toBe('2026-06-01T21:00:00.000Z');
    expect(out.notBefore).toBe('2026-06-01T12:00:00.000Z');
    expect(toUpdateInput(validState(), 'Asia/Tokyo').dueBy).toBe('2026-06-01T08:00:00.000Z');
  });

  it('round-trips an instant unchanged through the edit form in a non-UTC zone', () => {
    const state = toFormState(task(), 'Pacific/Auckland');
    expect(toUpdateInput(state, 'Pacific/Auckland').dueBy).toBe('2026-06-01T17:00:00.000Z');
  });
});
