import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { TaskDrawer } from './TaskDrawer';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const emptyCategories = () => fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);

describe('TaskDrawer', () => {
  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect((screen.getByTestId('duration-h') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('duration-m') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Write spec', priority: 2, durationMs: 5_400_000, dueBy: '2026-06-01T17:00:00.000Z',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work', status: 'pending',
    }));
  });

  it('blocks save and shows an error when min chunk > max chunk', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.change(screen.getByTestId('minchunk-h'), { target: { value: '5' } }); // 5h min > 2h max
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-maxChunkMs')).toBeInTheDocument();
  });

  it('surfaces a mutation ApiError', () => {
    renderWithProviders(
      <TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} error={new ApiError(409, 'conflict', 'Nope')} />,
      { api: emptyCategories() },
    );
    expect(screen.getByTestId('drawer-error')).toHaveTextContent('Nope');
  });

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a category dropdown and saves the chosen categoryId', async () => {
    const onSave = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([
      { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
      { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
    ]) } as never);
    renderWithProviders(<TaskDrawer task={task({ categoryId: 'cat-def' })} onSave={onSave} onCancel={() => {}} />, { api });
    // wait for categories to load (options rendered)
    await screen.findByRole('option', { name: 'Personal' });
    fireEvent.change(screen.getByTestId('category-select'), { target: { value: 'cat-p' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-p' })));
  });

  it('shows "— none —" selected when the task has no category', async () => {
    const onSave = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([
      { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
    ]) } as never);
    renderWithProviders(<TaskDrawer task={task({ categoryId: null }) as never} onSave={onSave} onCancel={() => {}} />, { api });
    await screen.findByRole('option', { name: 'Personal' });
    expect(screen.getByTestId('category-select')).toHaveValue('');
  });

  it('renders Schedule-after and saves notBefore', async () => {
    const onSave = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ notBefore: null }) as never} onSave={onSave} onCancel={() => {}} />, { api });
    fireEvent.change(await screen.findByTestId('schedule-after'), { target: { value: '2026-01-06T13:00' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notBefore: new Date('2026-01-06T13:00').toISOString() })));
  });
});
