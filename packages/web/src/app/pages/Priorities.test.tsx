import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Priorities } from './Priorities';

const NOW = Date.parse('2026-01-07T12:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', timeLoggedMs: 0,
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

const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });

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
    fireEvent.change(screen.getByPlaceholderText(/search for something/i), { target: { value: 'low' } });
    expect(screen.queryByText('Critical thing')).toBeNull();
    expect(screen.getByText('Low thing')).toBeInTheDocument();
  });

  it('hides completed tasks via the Filter dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Done thing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide completed/i }));
    expect(screen.queryByText('Done thing')).toBeNull();
  });

  it('hides a column via the Columns dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));
    expect(screen.queryByTestId('column-critical')).toBeNull();
    expect(screen.getByTestId('column-low')).toBeInTheDocument();
  });

  it('collapses a column to hide its tasks', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    const col = screen.getByTestId('column-critical');
    fireEvent.click(within(col).getByRole('button', { name: 'Collapse' }));
    expect(within(col).queryByText('Critical thing')).toBeNull();
  });

  it('reprioritizes via drag and drop', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const row = screen.getByText('Low thing').closest('[data-testid="task-row"]')! as HTMLElement;
    const target = screen.getByTestId('column-critical');
    const dt = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    // critical has one task (sortOrder:0); drop to bottom → sortOrder 0+1=1; cross-column → priority: 1
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('l1', { priority: 1, sortOrder: 1 }));
  });

  it('reorders within a column via drag (midpoint sortOrder, same priority)', async () => {
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'a', title: 'Alpha', priority: 2, sortOrder: 1 }),
      task({ id: 'b', title: 'Beta', priority: 2, sortOrder: 2 }),
      task({ id: 'c', title: 'Gamma', priority: 2, sortOrder: 3 }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    const rows = screen.getAllByTestId('task-row');
    const dt = dataTransfer();
    // drag Gamma over the TOP half of Alpha → insertion index 0 → sortOrder 1 - 1 = 0
    fireEvent.dragStart(rows[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt, clientY: 0 });
    fireEvent.drop(screen.getByTestId('column-high'), { dataTransfer: dt });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c', { sortOrder: 0 }));
  });

  it('cross-column drop sets priority AND a bottom sortOrder', async () => {
    const updateTask = vi.fn(async () => task());
    const listTasks = vi.fn(async () => [
      task({ id: 'a', title: 'Alpha', priority: 2, sortOrder: 1 }),
      task({ id: 'l', title: 'Lonely', priority: 4, sortOrder: 7 }),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateTask }) });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getAllByTestId('task-row')[0]!, { dataTransfer: dt }); // Alpha
    fireEvent.dragOver(screen.getByTestId('column-low'), { dataTransfer: dt });       // empty area of low column
    fireEvent.drop(screen.getByTestId('column-low'), { dataTransfer: dt });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('a', { priority: 4, sortOrder: 8 })); // below Lonely
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
    fireEvent.change(screen.getByPlaceholderText(/search for something/i), { target: { value: 'zzz' } });
    // The task is gone from the board but editing derives from the unfiltered query,
    // so the drawer must still be present
    expect(screen.queryByText('Low thing')).toBeNull();
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
  });

  it('toggles a subtask from the board card without opening the drawer', async () => {
    const updateSubtask = vi.fn(async () => ({ id: 's1', taskId: 'c1', title: 'step', done: true }));
    const listTasks = vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1, subtasks: [{ id: 's1', taskId: 'c1', title: 'step', done: false }] } as Partial<Task>),
    ]);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ listTasks, updateSubtask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('card-subtask-s1'));
    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith('s1', { done: true }));
    expect(screen.queryByTestId('task-drawer')).not.toBeInTheDocument();
  });
});
