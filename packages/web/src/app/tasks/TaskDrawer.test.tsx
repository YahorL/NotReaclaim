import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { TaskDrawer } from './TaskDrawer';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const emptyCategories = () => fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);

describe('TaskDrawer', () => {
  it('renders spent / total / left', () => {
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ durationMs: 7_200_000, spentMs: 1_800_000 })} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByTestId('drawer-spent')).toHaveTextContent('30m / 2h · 1h 30m left');
  });

  it('prefills from the task and saves a converted patch', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
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
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    // min chunk starts at 30m; 7 × +15m = 135m > the 120m max chunk
    const inc = screen.getByRole('button', { name: 'increase min' });
    for (let i = 0; i < 7; i++) fireEvent.click(inc);
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-maxChunkMs')).toBeInTheDocument();
  });

  it('closes (onCancel) on a pointerdown outside the drawer, but not inside it', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.pointerDown(screen.getByTestId('task-drawer')); // inside → stays open
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body); // outside → closes
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a mutation ApiError', () => {
    renderWithProviders(
      <TaskDrawer zone="UTC" task={task()} onSave={vi.fn()} onCancel={vi.fn()} error={new ApiError(409, 'conflict', 'Nope')} />,
      { api: emptyCategories() },
    );
    expect(screen.getByTestId('drawer-error')).toHaveTextContent('Nope');
  });

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a category dropdown and saves the chosen categoryId', async () => {
    const onSave = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([
      { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
      { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
    ]) } as never);
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ categoryId: 'cat-def' })} onSave={onSave} onCancel={() => {}} />, { api });
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
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ categoryId: null }) as never} onSave={onSave} onCancel={() => {}} />, { api });
    await screen.findByRole('option', { name: 'Personal' });
    expect(screen.getByTestId('category-select')).toHaveValue('');
  });

  it('renders Schedule-after and saves notBefore', async () => {
    const onSave = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ notBefore: null }) as never} onSave={onSave} onCancel={() => {}} />, { api });
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
    renderWithProviders(<TaskDrawer zone="UTC" task={t as never} onSave={() => {}} onCancel={() => {}} />, { api });

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
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const drawer = screen.getByTestId('task-drawer');
    expect(drawer.className).toContain('w-[440px]');
  });

  it('field grid is one column on a phone and two at md+', () => {
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const grid = screen.getByTestId('task-drawer').querySelector('.grid') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.classList.contains('grid-cols-1')).toBe(true);      // 165px columns cannot hold a datetime input
    expect(grid.classList.contains('md:grid-cols-2')).toBe(true);   // desktop two-column layout, unchanged
  });

  it('compact drops the fixed 440px panel chrome', () => {
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} compact onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const drawer = screen.getByTestId('task-drawer');
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).not.toContain('w-[440px]');
    // The host Sheet scrolls; a second scroll box here would trap the page inside the drawer.
    expect(drawer.className).not.toContain('overflow-y-auto');
  });

  it('compact installs no outside-dismiss of its own', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} compact onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.pointerDown(document.body); // the event the hook listens to since the pointerdown flip
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('TaskDrawer subtask drag handles', () => {
  const subtasks = [
    { id: 's1', taskId: 't', title: 'First', done: false, sortOrder: 0 },
    { id: 's2', taskId: 't', title: 'Last', done: false, sortOrder: 1 },
  ];

  it('each subtask row is a dnd-kit draggable, in sortOrder order', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
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
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
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

  it('announces a keyboard drag by subtask title and position — never by id', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    const row = screen.getByTestId('subtask-li-s2');
    const liveText = () => Array.from(document.querySelectorAll('[id^="DndLiveRegion"]')).map((e) => e.textContent).join('|');
    fireEvent.keyDown(row, { code: 'Space', key: ' ' });
    // jsdom has no layout, so dnd-kit follows the pick-up with an over on whichever row its zero
    // rects pick — either sentence proves the wiring; their wording is pinned in announcements.test.
    await waitFor(() => expect(liveText()).toMatch(/^(Picked up Last, position 2 of 2 in Write spec|Last is over position [12] of 2)\.$/));
    fireEvent.keyDown(row, { code: 'Escape', key: 'Escape' });
    await waitFor(() => expect(liveText()).toBe('Moving Last was cancelled.'));
  });

  it('no longer uses native HTML5 drag attributes or an insert line', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    expect(screen.getByTestId('subtask-li-s1')).not.toHaveAttribute('draggable');
    expect(screen.queryByTestId('subtask-insert-line')).toBeNull();
  });

  it('grows the subtask checkbox and delete control on a coarse pointer', () => {
    const subtasks = [{ id: 's1', taskId: 't1', title: 'First', done: false, sortOrder: 0 }];
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ subtasks })} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByTestId('subtask-toggle-s1').parentElement!.className).toContain('coarse:p-2.5');
    expect(screen.getByTestId('subtask-delete-s1').className).toContain('coarse:p-3');
  });
});

describe('TaskDrawer in the settings zone', () => {
  it('shows due / schedule-after as settings-zone wall-clock and saves the same instants back', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <TaskDrawer task={task({ notBefore: '2026-06-01T02:30:00.000Z' } as Partial<Task>)} zone="America/New_York" onSave={onSave} onCancel={vi.fn()} />,
      { api: emptyCategories() },
    );
    expect(screen.getByTestId('due-by')).toHaveValue('2026-06-01T13:00');
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-05-31T22:30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: '2026-06-01T17:00:00.000Z', notBefore: '2026-06-01T02:30:00.000Z',
    }));
  });

  it('interprets an edited due date in the settings zone (Tokyo)', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} zone="Asia/Tokyo" onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.change(screen.getByTestId('due-by'), { target: { value: '2026-06-03T09:00' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueBy: '2026-06-03T00:00:00.000Z' }));
  });

  it('re-seeds untouched date fields when the zone resolves late; an edited field keeps its wall-clock', () => {
    const onSave = vi.fn();
    const t = task();
    const { rerender } = renderWithProviders(<TaskDrawer task={t} zone="UTC" onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByTestId('due-by')).toHaveValue('2026-06-01T17:00');
    fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: '2026-06-01T08:00' } });
    rerender(<TaskDrawer task={t} zone="America/New_York" onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByTestId('due-by')).toHaveValue('2026-06-01T13:00');
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-06-01T08:00');
    fireEvent.click(screen.getByTestId('save'));
    // Untouched due keeps its stored instant; the typed schedule-after is read in the settings zone.
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: '2026-06-01T17:00:00.000Z', notBefore: '2026-06-01T12:00:00.000Z',
    }));
  });
});

describe('TaskDrawer: untouched dates are sent back unchanged', () => {
  const EDT_0130 = '2026-11-01T05:30:00.000Z'; // New York 01:30, first pass (EDT)
  const EST_0130 = '2026-11-01T06:30:00.000Z'; // New York 01:30, second pass (EST)

  it('a rename keeps due / schedule-after in the repeated DST hour at their exact instants', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <TaskDrawer task={task({ dueBy: EDT_0130, notBefore: EST_0130 } as Partial<Task>)} zone="America/New_York" onSave={onSave} onCancel={vi.fn()} />,
      { api: emptyCategories() },
    );
    expect(screen.getByTestId('due-by')).toHaveValue('2026-11-01T01:30');
    fireEvent.change(screen.getByDisplayValue('Write spec'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed', dueBy: EDT_0130, notBefore: EST_0130 }));
  });

  it('the untouched baseline follows the zone re-seed', () => {
    const onSave = vi.fn();
    const t = task({ dueBy: EDT_0130 });
    const { rerender } = renderWithProviders(<TaskDrawer task={t} zone="UTC" onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    rerender(<TaskDrawer task={t} zone="America/New_York" onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByTestId('due-by')).toHaveValue('2026-11-01T01:30');
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueBy: EDT_0130 }));
  });

  it('a changed date is converted and a cleared one is sent as null', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <TaskDrawer task={task({ dueBy: EDT_0130, notBefore: EST_0130 } as Partial<Task>)} zone="America/New_York" onSave={onSave} onCancel={vi.fn()} />,
      { api: emptyCategories() },
    );
    fireEvent.change(screen.getByTestId('due-by'), { target: { value: '2026-11-02T09:00' } });
    fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueBy: '2026-11-02T14:00:00.000Z', notBefore: null }));
  });

  it('in a zone that cannot show the dates (fields seed empty) a rename does not clear them', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <TaskDrawer task={task({ notBefore: EST_0130 } as Partial<Task>)} zone="Mars/Olympus_Mons" onSave={onSave} onCancel={vi.fn()} />,
      { api: emptyCategories() },
    );
    expect(screen.getByTestId('due-by')).toHaveValue('');
    fireEvent.change(screen.getByDisplayValue('Write spec'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueBy: '2026-06-01T17:00:00.000Z', notBefore: EST_0130 }));
  });
});

describe('TaskDrawer: a date that does not convert in the zone', () => {
  it('shows a Schedule-after error and blocks Save instead of saving "no value"', () => {
    const onSave = vi.fn();
    // A zone this runtime's Intl does not know: no wall-clock converts in it.
    renderWithProviders(<TaskDrawer task={task({ dueBy: null })} zone="Mars/Olympus_Mons" onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: '2026-06-01T08:00' } });
    expect(screen.getByTestId('err-notBeforeLocal')).toBeInTheDocument();
    expect(screen.getByTestId('save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('TaskDrawer: unsplit task (min = max = duration) keeps its chunks on the duration', () => {
  const H = 3_600_000;
  const unsplit = () => task({ durationMs: H, minChunkMs: H, maxChunkMs: H });

  it('60 → 90 via the duration stepper PATCHes 90 / 90 / 90 and the chunk steppers show it', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={unsplit()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    const inc = screen.getByRole('button', { name: 'increase duration' });
    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(screen.getAllByText('1 hr 30 min')).toHaveLength(3); // duration, min, max
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 5_400_000, minChunkMs: 5_400_000, maxChunkMs: 5_400_000 }));
  });

  it('60 → 30 via the duration stepper PATCHes 30 / 30 / 30', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={unsplit()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    const dec = screen.getByRole('button', { name: 'decrease duration' });
    fireEvent.click(dec);
    fireEvent.click(dec);
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1_800_000, minChunkMs: 1_800_000, maxChunkMs: 1_800_000 }));
  });

  it('once the user edits a chunk stepper, their chunk values are kept', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={unsplit()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: 'decrease min' }));   // min 45m: now a split task
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' })); // 75m
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 4_500_000, minChunkMs: 2_700_000, maxChunkMs: H }));
  });

  it('a split task (as loaded) changes only its duration, as before', () => {
    const onSave = vi.fn();
    renderWithProviders(<TaskDrawer zone="UTC" task={task()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' }));
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 6_300_000, minChunkMs: 1_800_000, maxChunkMs: 7_200_000 }));
  });

  it('a refetched task prop mid-edit does not clobber the edit or re-arm the follow rule', () => {
    const onSave = vi.fn();
    const { rerender } = renderWithProviders(<TaskDrawer zone="UTC" task={unsplit()} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: 'increase max' }));      // max 75m: user chose split
    rerender(<TaskDrawer zone="UTC" task={unsplit()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' })); // 75m
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 4_500_000, minChunkMs: H, maxChunkMs: 4_500_000 }));
  });

  it('a chunk stepper press that changes nothing (at the 15-min floor) does not stop the chunks following', () => {
    const onSave = vi.fn();
    const Q = 900_000;
    renderWithProviders(<TaskDrawer zone="UTC" task={task({ durationMs: Q, minChunkMs: Q, maxChunkMs: Q })} onSave={onSave} onCancel={vi.fn()} />, { api: emptyCategories() });
    fireEvent.click(screen.getByRole('button', { name: 'decrease min' }));      // already at the floor: no change
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' })); // 30m
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 2 * Q, minChunkMs: 2 * Q, maxChunkMs: 2 * Q }));
  });
});

