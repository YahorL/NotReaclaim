import { describe, it, expect } from 'vitest';
import type { Task, TaskStatus } from '../../api/types';
import { searchTasks } from './taskSearch';

let n = 0;
function task(title: string, over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `t${n}`, userId: 'u', title, priority: 3, sortOrder: n, durationMs: 3_600_000, dueBy: null,
    minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending' as TaskStatus,
    completedAt: null, subtasks: [], createdAt: '', updatedAt: '', ...over,
  };
}
const titles = (r: ReturnType<typeof searchTasks>) => r.map((m) => m.task.title);

describe('searchTasks', () => {
  it('returns nothing for a blank query', () => {
    expect(searchTasks([task('Write docs')], '   ')).toEqual([]);
  });

  it('matches title substrings case-insensitively', () => {
    const r = searchTasks([task('Write DOCS'), task('Email Bob'), task('Read the docs')], 'docs');
    expect(titles(r).sort()).toEqual(['Read the docs', 'Write DOCS']);
  });

  it('never returns archived tasks', () => {
    expect(searchTasks([task('Old docs', { status: 'archived' })], 'docs')).toEqual([]);
  });

  it('orders active before backlog before completed', () => {
    const r = searchTasks([
      task('docs done', { status: 'completed' }),
      task('docs later', { status: 'backlog' }),
      task('docs now', { status: 'scheduled' }),
      task('docs soon', { status: 'pending' }),
    ], 'docs');
    expect(titles(r)).toEqual(['docs now', 'docs soon', 'docs later', 'docs done']);
  });

  it('ranks prefix matches before inner matches within a status group', () => {
    const r = searchTasks([task('Read the plan'), task('Plan the week')], 'plan');
    expect(titles(r)).toEqual(['Plan the week', 'Read the plan']);
  });

  it('breaks ties by priority, then title', () => {
    const r = searchTasks([task('Fix b', { priority: 3 }), task('Fix a', { priority: 3 }), task('Fix c', { priority: 1 })], 'fix');
    expect(titles(r)).toEqual(['Fix c', 'Fix a', 'Fix b']);
  });

  it('matches subtask titles, ranked below title matches, and says which subtask', () => {
    const viaSub = task('Thesis', { subtasks: [{ id: 's1', taskId: 'x', title: 'Draft outline', done: false, sortOrder: 0 }] });
    const direct = task('Outline talk');
    const r = searchTasks([viaSub, direct], 'outline');
    expect(titles(r)).toEqual(['Outline talk', 'Thesis']);
    expect(r[1]!.subtask).toBe('Draft outline');
    expect(r[0]!.subtask).toBeNull();
  });

  it('caps the result count (default 8)', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`Item ${i}`));
    expect(searchTasks(many, 'item')).toHaveLength(8);
    expect(searchTasks(many, 'item', 3)).toHaveLength(3);
  });
});
