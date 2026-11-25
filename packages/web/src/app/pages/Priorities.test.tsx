import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import { Priorities } from './Priorities';

const NOW = Date.parse('2026-01-07T12:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const preview: SchedulePreview = { blocks: [], unscheduled: [] };

/**
 * Ends a jsdom mouse drag. dnd-kit keeps a capture-phase click blocker on the document for 50ms
 * after a drag ends (it swallows the click a real release produces), and jsdom shares `document`
 * across the tests of a file — so wait it out, or the next test's first click is eaten.
 */
async function releaseDrag(): Promise<void> {
  fireEvent.mouseUp(document, { clientX: 40, clientY: 40 });
  await act(() => new Promise((r) => { setTimeout(r, 60); }));
}

function makeApi(over = {}) {
  return fakeApiClient({
    listTasks: vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1 }),
      task({ id: 'l1', title: 'Low thing', priority: 4 }),
      task({ id: 'd1', title: 'Done thing', priority: 4, status: 'completed' }),
    ]),
    getSchedulePreview: vi.fn(async () => preview),
    updateTask: vi.fn(async () => task()),
    deleteTask: vi.fn(async () => undefined),
    ...over,
  } as never);
}

describe('Priorities board', () => {
  it('groups tasks into their priority columns', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    expect(within(screen.getByTestId('column-critical')).getByText('Critical thing')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-low')).getByText('Low thing')).toBeInTheDocument();
  });

  it('completes a task via the check button', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    const row = screen.getByText('Critical thing').closest('[data-testid="task-row"]')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c1', { status: 'completed' }));
  });

  it('filters by search text', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'low' } });
    expect(screen.queryByText('Critical thing')).toBeNull();
    expect(screen.getByText('Low thing')).toBeInTheDocument();
  });

  it('hides completed tasks via the Filter dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Done thing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /hide completed/i }));
    expect(screen.queryByText('Done thing')).toBeNull();
  });

  it('hides a column via the Columns dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^critical$/i }));
    expect(screen.queryByTestId('column-critical')).toBeNull();
    expect(screen.getByTestId('column-low')).toBeInTheDocument();
  });

  it('collapses a column to hide its tasks', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    const col = screen.getByTestId('column-critical');
    const toggle = within(col).getByRole('button', { name: 'Collapse Critical' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(within(col).queryByText('Critical thing')).toBeNull();
    // Collapsed = header only: name and count stay visible, the chevron now expands.
    expect(within(col).getByRole('heading', { name: 'Critical' })).toBeInTheDocument();
    expect(within(col).getByRole('button', { name: 'Expand Critical' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(within(col).getByRole('button', { name: 'Expand Critical' }));
    expect(within(col).getByText('Critical thing')).toBeInTheDocument();
  });

  it('opens the edit drawer from the row menu and deletes', async () => {
    const deleteTask = vi.fn(async () => undefined);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ deleteTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const row = screen.getByText('Low thing').closest('[data-testid="task-row"]')! as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /task menu/i }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('l1'));
  });

  it('opens the drawer when a row is clicked', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Low thing'));
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
  });

  it('keeps the edit drawer open when search filters the task out of its column', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    // Open the drawer for "Low thing" by clicking its row title
    fireEvent.click(screen.getByText('Low thing'));
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
    // Type a query that matches no task ("Low thing" disappears from columns)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'zzz' } });
    // The task is gone from the board but editing derives from the unfiltered query,
    // so the drawer must still be present
    expect(screen.queryByText('Low thing')).toBeNull();
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
  });

  it('re-seeds the edit drawer when the edited task changes while it stays mounted', async () => {
    // A click (no pointerdown) on another row is what keyboard activation produces: the drawer's
    // outside-dismiss never fires, so the drawer stays mounted while the edited task changes.
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1, dueBy: '2026-03-02T15:00:00.000Z' }),
      task({ id: 'l1', title: 'Low thing', priority: 4, dueBy: '2026-06-01T17:00:00.000Z' }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Low thing'));
    expect(within(screen.getByTestId('task-drawer')).getByDisplayValue('Low thing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Critical thing'));
    const drawer = screen.getByTestId('task-drawer');
    expect(within(drawer).getByDisplayValue('Critical thing')).toBeInTheDocument();
    expect(within(drawer).queryByDisplayValue('Low thing')).toBeNull();
    fireEvent.click(within(drawer).getByTestId('save'));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c1', expect.objectContaining({
      title: 'Critical thing', dueBy: '2026-03-02T15:00:00.000Z',
    })));
  });

  // ── Lifecycle column tests ──────────────────────────────────────────────────

  it('renders a completed task in column-completed, not in its priority bucket', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-completed')).toBeInTheDocument());
    expect(within(screen.getByTestId('column-completed')).getByText('Done thing')).toBeInTheDocument();
    // should NOT be in the low bucket (priority 4)
    expect(within(screen.getByTestId('column-low')).queryByText('Done thing')).toBeNull();
  });

  it('hide-completed hides the Completed column entirely', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-completed')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /hide completed/i }));
    expect(screen.queryByTestId('column-completed')).toBeNull();
    expect(screen.queryByText('Done thing')).toBeNull();
  });

  it('un-completes a task from the completed column via the ✓ button', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByTestId('column-completed')).toBeInTheDocument());
    const col = screen.getByTestId('column-completed');
    const row = within(col).getByTestId('task-row');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('d1', { status: 'pending' }));
  });

  it('toggles a subtask from the board card without opening the drawer', async () => {
    const updateSubtask = vi.fn(async () => ({ id: 's1', taskId: 'c1', title: 'step', done: true }));
    const listTasks = vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1, subtasks: [{ id: 's1', taskId: 'c1', title: 'step', done: false, sortOrder: 0 }] } as Partial<Task>),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateSubtask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('card-subtask-s1'));
    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { done: true }));
    expect(screen.queryByTestId('task-drawer')).not.toBeInTheDocument();
  });

  it('board cards are dnd-kit sortables via their grip, except in the Completed column', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Drag Low thing' })).toHaveAttribute('aria-roledescription', 'sortable');
    const doneRow = within(screen.getByTestId('column-completed')).getByTestId('task-row');
    expect(within(doneRow).queryByRole('button', { name: /^Drag / })).toBeNull();
    expect(doneRow).not.toHaveAttribute('draggable');
    expect(doneRow).toHaveAttribute('data-done', 'true');
  });

  it('heads each column with its name and task count, and says "Drop tasks here" when empty', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'High priority' })).toBeInTheDocument();
    expect(screen.getByTestId('column-count-critical')).toHaveTextContent('1');
    expect(screen.getByTestId('column-count-high')).toHaveTextContent('0');
    expect(screen.getByTestId('column-empty-high')).toHaveTextContent('Drop tasks here');
    expect(screen.getByTestId('column-empty-backlog')).toHaveTextContent('Drop tasks here');
    // While searching, an empty column says why it is empty instead.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'low' } });
    expect(screen.getByTestId('column-empty-critical')).toHaveTextContent('No matching tasks');
  });

  it('sizes the columns to a phone and snaps the pane to them', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    const column = screen.getByTestId('column-critical');
    const board = screen.getByTestId('board');
    // Below md each grid column is min(372px, 85vw): about one column per phone screen.
    expect(board.classList.contains('auto-cols-[min(372px,85vw)]')).toBe(true);
    // md+: columns share the width at ≥260px (prototype auto-fit minimum), scrolling when they can't.
    expect(board.classList.contains('md:auto-cols-[minmax(260px,1fr)]')).toBe(true);
    expect(board.classList.contains('grid-flow-col')).toBe(true);
    expect(column.className).toContain('snap-start');
    const pane = column.closest('.overflow-auto') as HTMLElement;
    expect(pane.className).toContain('snap-x');
    expect(pane.className).toContain('snap-mandatory');
    expect(pane.className).toContain('md:snap-none');  // no snapping under a mouse
    expect(pane.className).toContain('overscroll-contain');
    // The snap gutter matches the pane's own padding, so column 1 keeps its inset after a snap.
    expect(pane.classList.contains('scroll-pl-4')).toBe(true);
    expect(pane.classList.contains('px-4')).toBe(true);
  });
});

describe('Priorities board moves', () => {
  const gripOf = (title: string) => screen.getByRole('button', { name: `Drag ${title}` });

  it('ArrowRight on a grip moves the card to the next priority, persists it, announces it and keeps focus', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    gripOf('Critical thing').focus();
    fireEvent.keyDown(gripOf('Critical thing'), { key: 'ArrowRight' });
    // Shown at once (held + optimistic), not after the PATCH and its refetch. (The fake server
    // does not persist, so the post-success refetch would move it back — assert before that.)
    expect(within(screen.getByTestId('column-high')).getByText('Critical thing')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-critical')).queryByText('Critical thing')).toBeNull();
    expect(screen.getByTestId('board-announcer')).toHaveTextContent('Moved Critical thing to High priority, position 1.');
    // The card remounted in another column; focus followed it to its new grip.
    expect(document.activeElement).toBe(gripOf('Critical thing'));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c1', { priority: 2, sortOrder: 0 }));
  });

  it('ArrowDown / ArrowUp reorder within a column through sortOrder', async () => {
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'a', title: 'First', priority: 2, sortOrder: 0 }),
      task({ id: 'b', title: 'Second', priority: 2, sortOrder: 10 }),
      task({ id: 'c', title: 'Third', priority: 2, sortOrder: 20 }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    fireEvent.keyDown(gripOf('First'), { key: 'ArrowDown' });
    const order = () => within(screen.getByTestId('column-high')).getAllByTestId('task-row').map((r) => r.getAttribute('data-task-id'));
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(screen.getByTestId('board-announcer')).toHaveTextContent('Moved First to High priority, position 2.');
    expect(document.activeElement).toBe(gripOf('First'));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('a', { sortOrder: 15 }));
  });

  it('a refetch already in flight cannot undo the next move (it is cancelled before the write)', async () => {
    const initial = [
      task({ id: 'a', title: 'First', priority: 2, sortOrder: 0 }),
      task({ id: 'b', title: 'Second', priority: 2, sortOrder: 10 }),
      task({ id: 'c', title: 'Third', priority: 2, sortOrder: 20 }),
    ];
    // The server's state after move 1 only (a between b and c).
    const afterMove1 = [initial[1]!, { ...initial[0]!, sortOrder: 15 }, initial[2]!];
    let resolveRefetch: (v: Task[]) => void = () => {};
    const listTasks = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockImplementation(() => new Promise<Task[]>((r) => { resolveRefetch = r; }));
    // PATCH 1 succeeds (its invalidation starts a refetch); PATCH 2 stays in flight.
    const updateTask = vi.fn()
      .mockResolvedValueOnce(task())
      .mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    const order = () => within(screen.getByTestId('column-high')).getAllByTestId('task-row').map((r) => r.getAttribute('data-task-id'));

    fireEvent.keyDown(gripOf('First'), { key: 'ArrowDown' });
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2)); // refetch after PATCH 1, pending
    fireEvent.keyDown(gripOf('First'), { key: 'ArrowDown' });
    expect(order()).toEqual(['b', 'c', 'a']);
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(2));
    expect(updateTask).toHaveBeenLastCalledWith('a', { sortOrder: 21 });

    // The stale response (pre-move-2) arrives: it must not move the card back.
    await act(async () => { resolveRefetch(afterMove1); await Promise.resolve(); });
    await act(() => new Promise((r) => { setTimeout(r, 20); }));
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(document.activeElement).toBe(gripOf('First'));
  });

  it('ArrowUp on the top card and ArrowLeft from the first column do nothing', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.keyDown(gripOf('Critical thing'), { key: 'ArrowUp' });
    fireEvent.keyDown(gripOf('Critical thing'), { key: 'ArrowLeft' });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('a move into a collapsed column expands it', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('column-high')).getByRole('button', { name: 'Collapse High priority' }));
    fireEvent.keyDown(gripOf('Critical thing'), { key: 'ArrowRight' });
    const high = screen.getByTestId('column-high');
    expect(within(high).getByRole('button', { name: 'Collapse High priority' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(high).getByText('Critical thing')).toBeInTheDocument();
  });

  it('rolls the move back when the PATCH fails', async () => {
    const updateTask = vi.fn(async () => { throw new Error('boom'); });
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.keyDown(gripOf('Critical thing'), { key: 'ArrowRight' });
    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    await waitFor(() => expect(within(screen.getByTestId('column-critical')).getByText('Critical thing')).toBeInTheDocument());
  });

  it('a mouse drag lifts a tilted clone and leaves a placeholder; releasing on nothing moves nothing', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const card = screen.getByText('Low thing').closest('[data-testid="task-row"]') as HTMLElement;
    fireEvent.mouseDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByTestId('board-drag-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('board-drag-overlay')).toHaveTextContent('Low thing');
    expect(screen.getByTestId('board-drag-overlay').style.transform).toBe('rotate(-1.5deg) scale(1.03)');
    expect(card).toHaveAttribute('data-placeholder', 'true');
    expect(card).toHaveAttribute('data-dragging', 'true');
    await releaseDrag();
    expect(card).not.toHaveAttribute('data-placeholder');
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('a mouse press on the card\'s ✓ button never starts a drag', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const card = screen.getByText('Low thing').closest('[data-testid="task-row"]') as HTMLElement;
    fireEvent.mouseDown(within(card).getByRole('button', { name: 'complete' }), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    expect(screen.queryByTestId('board-drag-overlay')).toBeNull();
    await releaseDrag();
  });
});

describe('Priorities page states', () => {
  it('announces loading while the tasks query is pending', async () => {
    const listTasks = vi.fn(() => new Promise<Task[]>(() => {}));
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks }) });
    expect(await screen.findByRole('status')).toHaveTextContent('Loading tasks…');
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('shows an alert with a Retry that refetches when the tasks query fails', async () => {
    let fail = true;
    const listTasks = vi.fn(async () => {
      if (fail) throw new Error('down');
      return [task({ id: 'c1', title: 'Critical thing', priority: 1 })];
    });
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks }) });
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent("Couldn't load tasks.");
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Critical thing')).toBeInTheDocument();
  });

  it('un-snaps the board pane for the duration of a drag', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const pane = screen.getByTestId('board').closest('.overflow-auto') as HTMLElement;
    expect(pane.classList.contains('snap-mandatory')).toBe(true);
    const card = screen.getByText('Low thing').closest('[data-testid="task-row"]') as HTMLElement;
    fireEvent.mouseDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(pane.classList.contains('snap-none')).toBe(true));
    expect(pane.classList.contains('snap-mandatory')).toBe(false);
    await releaseDrag();
    expect(pane.classList.contains('snap-mandatory')).toBe(true);
  });
});

describe('Priorities compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('opens the edit drawer as a full-screen sheet', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Critical thing'));
    const sheet = screen.getByRole('dialog', { name: 'Edit task' });
    expect(sheet.className).toContain('h-dvh');
    expect(within(sheet).getByTestId('task-drawer')).toBeInTheDocument();
  });
});
