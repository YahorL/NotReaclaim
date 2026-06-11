import { describe, it, expect } from 'vitest';
import type { Task } from '../../api/types';
import { defaultQuickAddInput, toFormState, validateTaskForm, toUpdateInput, type TaskFormState } from './taskForm';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', completedAt: null, timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<TaskFormState> = {}): TaskFormState => ({
  title: 'X', durationMs: 3_600_000, dueByLocal: '2026-06-01T17:00',
  notBeforeLocal: '',
  minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null, status: 'pending', ...over,
});

describe('taskForm', () => {
  it('defaultQuickAddInput uses smart defaults and the injected now', () => {
    const input = defaultQuickAddInput('  New task  ', NOW);
    expect(input).toEqual({
      title: 'New task', priority: 3, durationMs: 3_600_000,
      dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null, notBefore: null,
    });
  });

  it('defaultQuickAddInput uses provided chunk defaults when given', () => {
    const input = defaultQuickAddInput('Task', NOW, { minChunkMs: 900_000, maxChunkMs: 5_400_000 });
    expect(input.minChunkMs).toBe(900_000);
    expect(input.maxChunkMs).toBe(5_400_000);
    expect(input.durationMs).toBe(3_600_000); // unchanged
  });

  it('toFormState maps a Task (ISO due → local; categoryId passthrough)', () => {
    expect(toFormState(task())).toEqual({
      title: 'Write spec', durationMs: 5_400_000, dueByLocal: '2026-06-01T17:00',
      notBeforeLocal: '',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work', status: 'pending',
    });
    expect(toFormState(task({ categoryId: null })).categoryId).toBeNull();
  });

  it('validateTaskForm flags empty title, non-positive durations, min>max, bad due', () => {
    expect(validateTaskForm(validState()).ok).toBe(true);
    expect(validateTaskForm(validState({ title: '   ' })).errors.title).toBeTruthy();
    expect(validateTaskForm(validState({ durationMs: 0 })).errors.durationMs).toBeTruthy();
    expect(validateTaskForm(validState({ minChunkMs: 8_000_000 })).errors.maxChunkMs).toBeTruthy();
    expect(validateTaskForm(validState({ dueByLocal: '' })).errors.dueByLocal).toBeTruthy();
  });

  it('toUpdateInput converts local due → ISO and passes categoryId, includes status', () => {
    expect(toUpdateInput(validState({ categoryId: null, status: 'scheduled' }))).toEqual({
      title: 'X', durationMs: 3_600_000, dueBy: '2026-06-01T17:00:00.000Z',
      notBefore: null,
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null, status: 'scheduled',
    });
  });

  it('round-trips categoryId through the edit form', () => {
    const state = toFormState(task({ categoryId: 'cat-7' }));
    expect(state.categoryId).toBe('cat-7');
    expect(toUpdateInput(state).categoryId).toBe('cat-7');
  });

  it('round-trips notBefore through the edit form', () => {
    const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: null, notBefore: '2026-01-06T13:00:00.000Z', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
    const state = toFormState(task as never);
    expect(state.notBeforeLocal).not.toBe('');
    expect(toUpdateInput(state).notBefore).toBe(new Date(state.notBeforeLocal).toISOString());
    expect(toUpdateInput({ ...state, notBeforeLocal: '' }).notBefore).toBeNull();
  });
});
