import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
