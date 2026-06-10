import { describe, it, expect } from 'vitest';
import type { ScheduledBlock, Task } from '../../api/types';
import { labelBlocksWithSubtasks } from './blockLabels';

const block = (id: string, taskId: string | null, startsAt: string): ScheduledBlock =>
  ({ id, userId: 'u', taskId, habitId: taskId ? null : 'h1', title: 'Write report', startsAt, endsAt: startsAt, pinned: false, engineKey: null } as ScheduledBlock);
const task = (id: string, title: string, subtasks: Array<{ id: string; title: string; done: boolean }>): Task =>
  ({ id, userId: 'u', title, priority: 2, sortOrder: 0, durationMs: 1, dueBy: '', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '', subtasks: subtasks.map((s) => ({ ...s, taskId: id })) } as Task);

describe('labelBlocksWithSubtasks', () => {
  it('labels a task\'s blocks with its open subtasks in start order', () => {
    const blocks = [
      block('b2', 't1', '2026-01-06T10:00:00.000Z'),
      block('b1', 't1', '2026-01-05T09:00:00.000Z'),
      block('b3', 't1', '2026-01-07T10:00:00.000Z'),
    ];
    const tasks = [task('t1', 'Write report', [
      { id: 's0', title: 'done already', done: true },
      { id: 's1', title: 'outline', done: false },
      { id: 's2', title: 'draft', done: false },
    ])];
    const out = labelBlocksWithSubtasks(blocks, tasks);
    const byId = Object.fromEntries(out.map((b) => [b.id, b.title]));
    expect(byId['b1']).toBe('Write report: outline'); // earliest block ← first open subtask
    expect(byId['b2']).toBe('Write report: draft');
    expect(byId['b3']).toBe('Write report');          // more blocks than open subtasks → plain title
  });

  it('leaves habit blocks and tasks without open subtasks untouched (same array when nothing applies)', () => {
    const blocks = [block('b1', null, '2026-01-05T09:00:00.000Z')];
    expect(labelBlocksWithSubtasks(blocks, [task('t1', 'X', [])])).toBe(blocks);
  });
});
