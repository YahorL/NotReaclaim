import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { PlannerTaskPanel } from './PlannerTaskPanel';

const NOW = Date.parse('2026-01-07T12:00:00.000Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
    durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
    categoryId: null, notBefore: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
    createdAt: '', updatedAt: '', subtasks: [], ...over,
  } as Task;
}

function renderPanel(tasks: Task[], preview?: SchedulePreview, handlers: Partial<{
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}> = {}) {
  return render(
    <PlannerTaskPanel
      tasks={tasks}
      preview={preview}
      nowMs={NOW}
      onComplete={handlers.onComplete ?? vi.fn()}
      onEdit={handlers.onEdit ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
    />,
  );
}

describe('PlannerTaskPanel', () => {
  it('groups active tasks under their priority bucket and shows a duration chip', () => {
    renderPanel([
      task({ id: 'a', title: 'Critical thing', priority: 1, durationMs: 7_200_000 }),
      task({ id: 'b', title: 'Low thing', priority: 4 }),
    ]);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Low priority')).toBeInTheDocument();
    expect(screen.getByText('Critical thing')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument(); // 7.2M ms → 2h chip
  });

  it('omits backlog and completed tasks', () => {
    renderPanel([
      task({ id: 'a', title: 'Active', status: 'pending' }),
      task({ id: 'b', title: 'In backlog', status: 'backlog' }),
      task({ id: 'c', title: 'Done', status: 'completed' }),
    ]);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('In backlog')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('fires complete / edit / delete handlers', () => {
    const onComplete = vi.fn(); const onEdit = vi.fn(); const onDelete = vi.fn();
    renderPanel([task({ id: 'a', title: 'Do it' })], undefined, { onComplete, onEdit, onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Do it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Do it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Do it' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('flags an at-risk (unscheduled) task', () => {
    const preview: SchedulePreview = {
      blocks: [],
      unscheduled: [{ sourceType: 'task', sourceId: 'a', title: 'Risky', reason: 'no time', remainingMs: 3_600_000 }],
    };
    renderPanel([task({ id: 'a', title: 'Risky' })], preview);
    expect(screen.getByTestId('panel-at-risk')).toBeInTheDocument();
  });

  it('switches to a flat Tasks tab', () => {
    renderPanel([
      task({ id: 'a', title: 'Critical thing', priority: 1 }),
      task({ id: 'b', title: 'Low thing', priority: 4 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
    // Bucket headers gone in the flat view; both tasks still listed
    expect(screen.queryByText('Critical')).toBeNull();
    expect(screen.getByText('Critical thing')).toBeInTheDocument();
    expect(screen.getByText('Low thing')).toBeInTheDocument();
  });

  it('shows an empty state when there are no active tasks', () => {
    renderPanel([]);
    expect(screen.getByText(/no active tasks/i)).toBeInTheDocument();
  });

  it('shows spent / total on a card', () => {
    renderPanel([task({ id: 'a', title: 'Has progress', durationMs: 7_200_000, spentMs: 3_600_000 })]);
    expect(screen.getByTestId('panel-progress')).toHaveTextContent('1h / 2h');
  });

  it('task cards are draggable and seed the dataTransfer with the task id', () => {
    renderPanel([task({ id: 'drag-me', title: 'Grab me' })]);
    const card = screen.getByTestId('panel-task');
    expect(card).toHaveAttribute('draggable', 'true');
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'drag-me');
    expect(setData).toHaveBeenCalledWith('application/x-nr-task', 'drag-me');
  });

});
