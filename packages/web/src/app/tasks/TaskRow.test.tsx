import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../../api/types';
import { TaskRow } from './TaskRow';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: 'work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Partial<Task> = {}) {
  const onEdit = vi.fn(); const onComplete = vi.fn(); const onDelete = vi.fn();
  render(<TaskRow task={task(over)} onEdit={onEdit} onComplete={onComplete} onDelete={onDelete} />);
  return { onEdit, onComplete, onDelete };
}

describe('TaskRow', () => {
  it('renders title, category and duration/priority meta', () => {
    setup();
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('Write spec');
    expect(row).toHaveTextContent('work');
    expect(row).toHaveTextContent('1h');
    expect(row).toHaveTextContent('P2');
  });

  it('edit and complete fire their callbacks', () => {
    const { onEdit, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'complete' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('delete requires an inline confirm', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('cancel closes the confirm without deleting', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument();
  });

  it('completed task is struck through and has no complete button', () => {
    setup({ status: 'completed' });
    expect(screen.queryByRole('button', { name: 'complete' })).toBeNull();
    expect(screen.getByText('Write spec')).toHaveClass('line-through');
  });
});
