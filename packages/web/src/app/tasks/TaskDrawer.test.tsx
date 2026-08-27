import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
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
  it('renders spent / total / left', () => {
    renderWithProviders(<TaskDrawer task={task({ durationMs: 7_200_000, spentMs: 1_800_000 })} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByTestId('drawer-spent')).toHaveTextContent('30m / 2h · 1h 30m left');
  });

  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Write spec', durationMs: 5_400_000, dueBy: '2026-06-01T17:00:00.000Z',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work',
    }));
    // status is board-owned — must NOT be in the PATCH
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }));
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

  it('closes (onCancel) on a mousedown outside the drawer, but not inside it', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.mouseDown(screen.getByTestId('task-drawer')); // inside → stays open
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body); // outside → closes
    expect(onCancel).toHaveBeenCalledTimes(1);
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

describe('TaskDrawer layout', () => {
  it('drawer root has w-[440px] class for two-column layout', () => {
    renderWithProviders(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const drawer = screen.getByTestId('task-drawer');
    expect(drawer.className).toContain('w-[440px]');
  });

  it('field grid has grid grid-cols-2 class', () => {
    renderWithProviders(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const drawer = screen.getByTestId('task-drawer');
    // The field grid should exist inside the drawer
    expect(drawer.querySelector('.grid.grid-cols-2')).not.toBeNull();
  });
});

describe('TaskDrawer subtask drag handles', () => {
  const subtasks = [
    { id: 's1', taskId: 't', title: 'First', done: false, sortOrder: 0 },
    { id: 's2', taskId: 't', title: 'Last', done: false, sortOrder: 1 },
  ];

  it('each subtask row is a dnd-kit draggable, in sortOrder order', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    const first = screen.getByTestId('subtask-li-s1');
    const second = screen.getByTestId('subtask-li-s2');
    expect(first).toHaveAttribute('aria-roledescription', 'sortable');
    expect(second).toHaveAttribute('aria-roledescription', 'sortable');
    // dnd-kit defaults a draggable to role="button"; on an <li> that destroys the list semantics
    // and nests the checkbox/delete control inside a button role, so the row keeps role=listitem.
    expect(first).toHaveAttribute('role', 'listitem');
    // Keyboard reordering comes free with the KeyboardSensor; the row must be focusable for it.
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Space on a subtask control is not swallowed by the keyboard drag sensor', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    // The row carries the KeyboardSensor's onKeyDown, so a Space keydown from the delete button
    // bubbles into it. dnd-kit only ignores descendants when the row registered itself via
    // setActivatorNodeRef; without that it preventDefaults the key and the button goes dead.
    const del = screen.getByTestId('subtask-delete-s1');
    const ev = createEvent.keyDown(del, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    fireEvent(del, ev);
    expect(ev.defaultPrevented).toBe(false);
    // ...while the same key on the row itself is claimed by the sensor, i.e. the row is still the
    // activator and keyboard reordering works.
    const row = screen.getByTestId('subtask-li-s1');
    const rowEv = createEvent.keyDown(row, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    fireEvent(row, rowEv);
    expect(rowEv.defaultPrevented).toBe(true);
  });

  it('no longer uses native HTML5 drag attributes or an insert line', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    expect(screen.getByTestId('subtask-li-s1')).not.toHaveAttribute('draggable');
    expect(screen.queryByTestId('subtask-insert-line')).toBeNull();
  });
});
