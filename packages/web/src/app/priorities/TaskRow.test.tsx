import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void } = {}) {
  return render(
    <TaskRow
      task={task} bucket="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop} onDragStart={noop} onDragEnd={noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
    />,
  );
}

const twoSubtasks = [
  { id: 's1', taskId: 't', title: 'first step', done: true },
  { id: 's2', taskId: 't', title: 'second step', done: false },
];

describe('TaskRow subtask badge', () => {
  it('shows done/total when the task has subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
  });
  it('shows no badge when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
  });
});

describe('TaskRow subtask checklist', () => {
  it('renders one checkbox row per subtask, checked when done', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step')).toBeInTheDocument();
    expect(screen.getByText('second step')).toBeInTheDocument();
    expect(screen.getByTestId('card-subtask-s1')).toBeChecked();
    expect(screen.getByTestId('card-subtask-s2')).not.toBeChecked();
  });

  it('strikes through done subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step').className).toContain('line-through');
    expect(screen.getByText('second step').className).not.toContain('line-through');
  });

  it('toggling a checkbox reports the flipped value and does not open the editor', () => {
    const onToggleSubtask = vi.fn();
    const onEdit = vi.fn();
    renderRow({ ...base, subtasks: twoSubtasks } as Task, { onEdit, onToggleSubtask });
    fireEvent.click(screen.getByTestId('card-subtask-s2'));
    expect(onToggleSubtask).toHaveBeenCalledWith('s2', true);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('renders no checklist when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('card-subtasks')).not.toBeInTheDocument();
  });
});
