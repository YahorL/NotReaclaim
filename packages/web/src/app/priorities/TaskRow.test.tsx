import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task) {
  return render(<TaskRow task={task} bucket="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false} onComplete={noop} onEdit={noop} onDelete={noop} onDragStart={noop} onDragEnd={noop} />);
}

describe('TaskRow subtask badge', () => {
  it('shows done/total when the task has subtasks', () => {
    renderRow({ ...base, subtasks: [{ id: 's1', taskId: 't', title: 'a', done: true }, { id: 's2', taskId: 't', title: 'b', done: false }] } as Task);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
  });
  it('shows no badge when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
  });
});
