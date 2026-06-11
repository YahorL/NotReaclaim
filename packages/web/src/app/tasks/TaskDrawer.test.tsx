import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { TaskDrawer } from './TaskDrawer';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', completedAt: null, timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const emptyCategories = () => fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);

describe('TaskDrawer', () => {
  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Write spec', durationMs: 5_400_000, dueBy: '2026-06-01T17:00:00.000Z',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work', status: 'pending',
    }));
  });

  it('blocks save and shows an error when min chunk > max chunk', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    // min chunk starts at 30m; 7 × +15m = 135m > the 120m max chunk
    const inc = screen.getByRole('button', { name: 'increase min' });
    for (let i = 0; i < 7; i++) fireEvent.click(inc);
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

  it('lists subtasks, adds, toggles, and deletes them', async () => {
    const createSubtask = vi.fn().mockResolvedValue({ id: 's2', taskId: 't', title: 'new', done: false });
    const updateSubtask = vi.fn().mockResolvedValue({ id: 's1', taskId: 't', title: 'a', done: true });
    const deleteSubtask = vi.fn().mockResolvedValue(undefined);
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]), createSubtask, updateSubtask, deleteSubtask } as never);
    const t = task({ id: 't', subtasks: [{ id: 's1', taskId: 't', title: 'a', done: false, sortOrder: 0 }] });
    renderWithProviders(<TaskDrawer task={t as never} onSave={() => {}} onCancel={() => {}} />, { api });

    expect(await screen.findByText('a')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('subtask-toggle-s1'));
    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { done: true }));
    fireEvent.click(screen.getByTestId('subtask-delete-s1'));
    await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith('s1'));
    fireEvent.change(screen.getByTestId('subtask-input'), { target: { value: 'new' } });
    fireEvent.click(screen.getByTestId('subtask-add'));
    await waitFor(() => expect(createSubtask).toHaveBeenCalledWith({ taskId: 't', title: 'new' }));
  });
});

describe('TaskDrawer subtask drag-reorder', () => {
  // Two subtasks: first at sortOrder=0, last at sortOrder=1
  const subtasks = [
    { id: 's1', taskId: 't', title: 'First', done: false, sortOrder: 0 },
    { id: 's2', taskId: 't', title: 'Last', done: false, sortOrder: 1 },
  ];
  const t = () => task({ id: 't', subtasks });

  it('drag last subtask above first → PATCH sortOrder = first.sortOrder - 1', async () => {
    const updateSubtask = vi.fn().mockResolvedValue({});
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]), updateSubtask } as never);
    renderWithProviders(<TaskDrawer task={t() as never} onSave={() => {}} onCancel={() => {}} />, { api });

    // jsdom: getBoundingClientRect returns all zeros (height=0) → insert above → index=0
    // drag s2 (last) over s1 (first) → after off-by-one: source(s2) is BELOW target(s1),
    // no decrement needed → index stays 0 → insertionSortOrder([s1], 0) = s1.sortOrder - 1 = -1
    const lastLi = screen.getByTestId('subtask-li-s2');
    const firstLi = screen.getByTestId('subtask-li-s1');

    const dt = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(lastLi, { dataTransfer: dt });
    // Firefox fix: dragstart must call setData so the subtask drag is not aborted
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 's2');
    fireEvent.dragOver(firstLi);
    fireEvent.drop(firstLi);

    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s2', { sortOrder: -1 }));
  });

  it('drag first subtask below second (downward) → midpoint of remaining neighbors (off-by-one guard)', async () => {
    const updateSubtask = vi.fn().mockResolvedValue({});
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]), updateSubtask } as never);
    renderWithProviders(<TaskDrawer task={t() as never} onSave={() => {}} onCancel={() => {}} />, { api });

    // drag s1 (first) over s2 (last):
    // jsdom height=0 → insert above s2 → raw index=1
    // source s1 is at index 0, target index=1: source is above target → decrement → index=0
    // others (excluding s1) = [s2 sortOrder=1]
    // insertionSortOrder([s2], 0) = s2.sortOrder - 1 = 0
    const firstLi = screen.getByTestId('subtask-li-s1');
    const lastLi = screen.getByTestId('subtask-li-s2');

    fireEvent.dragStart(firstLi);
    fireEvent.dragOver(lastLi);
    fireEvent.drop(lastLi);

    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { sortOrder: 0 }));
  });
});
