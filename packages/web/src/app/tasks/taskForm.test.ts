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

  it('defaultQuickAddInput uses provided chunk defaults when given', () => {
    const input = defaultQuickAddInput('Task', NOW, { minChunkMs: 900_000, maxChunkMs: 5_400_000 });
    expect(input.minChunkMs).toBe(900_000);
    expect(input.maxChunkMs).toBe(5_400_000);
    expect(input.durationMs).toBe(3_600_000); // unchanged
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
