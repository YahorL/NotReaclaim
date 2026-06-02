import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from './NewTaskModal';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const task = (over: Partial<Task> = {}): Task => ({
  id: 't9', userId: 'u1', title: 'x', priority: 4, durationMs: 3_600_000,
  dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function api(createTask = vi.fn(async () => task())) {
  return { createTask, getSettings: vi.fn(() => Promise.reject(new Error('404'))) };
}

describe('NewTaskModal', () => {
  it('creates a task with priority 4 from the entered name', async () => {
    const createTask = vi.fn(async () => task());
    const onClose = vi.fn();
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={onClose} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write spec' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec', priority: 4, durationMs: 3_600_000 })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not create when the name is empty (Create disabled)', () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('with Split off, sends min=max=duration', async () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Solid block' } });
    fireEvent.click(screen.getByRole('button', { name: /split up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })));
  });

  it('defaults to the default category and submits its id', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: 't1' });
    const api = fakeApiClient({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      listCategories: vi.fn().mockResolvedValue([
        { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
        { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
      ]),
      createTask,
    } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

    fireEvent.change(await screen.findByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    await waitFor(() => expect(screen.getByTestId('category-select')).toHaveValue('cat-def'));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-def' })));
  });

  it('creates a new category and selects it', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-new', userId: 'u', name: 'Deep Work', windows: [], isDefault: false });
    const api = fakeApiClient({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      listCategories: vi.fn().mockResolvedValue([{ id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]),
      createCategory,
    } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

    fireEvent.click(await screen.findByTestId('new-category-btn'));
    fireEvent.change(screen.getByTestId('new-category-name'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('new-category-confirm'));
    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'Deep Work', windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] }));
  });
});
