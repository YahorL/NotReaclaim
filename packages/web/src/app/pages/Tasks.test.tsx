import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import type { Settings } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Tasks } from './Tasks';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC', workingHours: [],
  horizonDays: 14, defaultMinChunkMs: 15 * 60_000, defaultMaxChunkMs: 90 * 60_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function makeApi(over = {}) {
  return fakeApiClient({
    listTasks: vi.fn(async () => [task(), task({ id: 't2', title: 'Done thing', status: 'completed' })]),
    createTask: vi.fn(async () => task({ id: 't9' })),
    updateTask: vi.fn(async () => task()),
    deleteTask: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => settings()),
    ...over,
  } as never);
}

describe('Tasks page', () => {
  it('lists active tasks by default and filters by tab', async () => {
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.queryByText('Done thing')).toBeNull(); // completed hidden under Active
    fireEvent.click(screen.getByTestId('tab-completed'));
    expect(screen.getByText('Done thing')).toBeInTheDocument();
    expect(screen.queryByText('Write spec')).toBeNull();
  });

  it('quick-add creates a task with defaults from injected now', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ createTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'New thing', durationMs: 3_600_000, dueBy: '2026-01-12T00:00:00.000Z' })));
  });

  it('completing a task calls updateTask with status completed', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'complete' })[0]!);
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('t1', { status: 'completed' }));
  });

  it('editing opens the drawer and saves', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'edit' })[0]!);
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(updateTask).toHaveBeenCalled());
  });

  it('quick-add uses chunk defaults from loaded settings', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ createTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 900_000, maxChunkMs: 5_400_000 })));
  });

  it('quick-add falls back to 30m/120m when settings are unavailable (404)', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    const api = makeApi({ createTask, getSettings: vi.fn(() => Promise.reject(new ApiError(404, 'not_found', 'x'))) });
    renderWithProviders(<Tasks now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 1_800_000, maxChunkMs: 7_200_000 })));
  });
});
