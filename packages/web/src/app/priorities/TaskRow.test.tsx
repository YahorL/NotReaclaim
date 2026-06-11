import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, sortOrder: 0, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void; onReorderSubtask?: (subtaskId: string, sortOrder: number) => void; onDragStart?: (taskId: string) => void; onDragEnd?: () => void } = {}) {
  return render(
    <TaskRow
      task={task} columnKey="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop}
      onDragStart={over.onDragStart ?? noop} onDragEnd={over.onDragEnd ?? noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
      onReorderSubtask={over.onReorderSubtask ?? noop}
    />,
  );
}

const twoSubtasks = [
  { id: 's1', taskId: 't', title: 'first step', done: true, sortOrder: 0 },
  { id: 's2', taskId: 't', title: 'second step', done: false, sortOrder: 1 },
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

const threeSubtasks = [
  { id: 's1', taskId: 't', title: 'first', done: false, sortOrder: 10 },
  { id: 's2', taskId: 't', title: 'second', done: false, sortOrder: 20 },
  { id: 's3', taskId: 't', title: 'third', done: false, sortOrder: 30 },
];

describe('TaskRow card subtask drag-reorder', () => {
  it('dragging last subtask above first calls onReorderSubtask(id, first.sortOrder-1)', () => {
    const onReorderSubtask = vi.fn();
    renderRow({ ...base, subtasks: threeSubtasks } as Task, { onReorderSubtask });
    const lis = screen.getAllByRole('listitem');
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    // drag s3 (last)
    fireEvent.dragStart(lis[2]!, { dataTransfer: dt });
    // dragOver s1 with zero-height rect → inserts above s1 → index 0
    fireEvent.dragOver(lis[0]!, { dataTransfer: dt, clientY: 0 });
    fireEvent.drop(lis[0]!, { dataTransfer: dt });
    // others after removing s3 = [s1(10), s2(20)]; insert at index 0 → 10 - 1 = 9
    expect(onReorderSubtask).toHaveBeenCalledWith('s3', 9);
  });

  it('dragging first subtask downward (over third) calls onReorderSubtask with midpoint', () => {
    const onReorderSubtask = vi.fn();
    renderRow({ ...base, subtasks: threeSubtasks } as Task, { onReorderSubtask });
    const lis = screen.getAllByRole('listitem');
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    // drag s1 (first)
    fireEvent.dragStart(lis[0]!, { dataTransfer: dt });
    // dragOver s3 with zero-height rect → inserts above s3 → index 2 in full list
    fireEvent.dragOver(lis[2]!, { dataTransfer: dt, clientY: 0 });
    fireEvent.drop(lis[2]!, { dataTransfer: dt });
    // src index 0, insert index 2 → since srcIndex(0) < insertIdx(2), adjustedIdx = 2-1 = 1
    // others after removing s1 = [s2(20), s3(30)]; insert at index 1 → midpoint(20,30) = 25
    expect(onReorderSubtask).toHaveBeenCalledWith('s1', 25);
  });

  it('subtask dragStart does NOT trigger the task-card drag (stopPropagation)', () => {
    const onDragStart = vi.fn();
    const onReorderSubtask = vi.fn();
    renderRow({ ...base, subtasks: threeSubtasks } as Task, { onDragStart, onReorderSubtask });
    const lis = screen.getAllByRole('listitem');
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(lis[0]!, { dataTransfer: dt });
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('task-card drag still works after a subtask drag ends', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onReorderSubtask = vi.fn();
    renderRow({ ...base, subtasks: threeSubtasks } as Task, { onDragStart, onDragEnd, onReorderSubtask });
    const lis = screen.getAllByRole('listitem');
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    // do a subtask drag+end
    fireEvent.dragStart(lis[0]!, { dataTransfer: dt });
    fireEvent.dragEnd(lis[0]!, { dataTransfer: dt });
    // now drag the card row itself
    const row = screen.getByTestId('task-row');
    const rowDt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(row, { dataTransfer: rowDt });
    expect(onDragStart).toHaveBeenCalledWith('t');
    expect(rowDt.setData).toHaveBeenCalledWith('text/plain', 't');
  });
});
