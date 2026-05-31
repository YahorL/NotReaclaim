import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { TaskDrawer } from './TaskDrawer';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: 'work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('TaskDrawer', () => {
  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    render(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />);
    expect((screen.getByTestId('duration-h') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('duration-m') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Write spec', priority: 2, durationMs: 5_400_000, dueBy: '2026-06-01T17:00:00.000Z',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, category: 'work', status: 'pending',
    }));
  });

  it('blocks save and shows an error when min chunk > max chunk', () => {
    const onSave = vi.fn();
    render(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('minchunk-h'), { target: { value: '5' } }); // 5h min > 2h max
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-maxChunkMs')).toBeInTheDocument();
  });

  it('surfaces a mutation ApiError', () => {
    render(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} error={new ApiError(409, 'conflict', 'Nope')} />);
    expect(screen.getByTestId('drawer-error')).toHaveTextContent('Nope');
  });

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
