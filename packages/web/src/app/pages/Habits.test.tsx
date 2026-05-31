import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Habits } from './Habits';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function makeApi(over = {}) {
  return fakeApiClient({
    listHabits: vi.fn(async () => [habit()]),
    createHabit: vi.fn(async () => habit({ id: 'h9' })),
    updateHabit: vi.fn(async () => habit()),
    deleteHabit: vi.fn(async () => undefined),
    ...over,
  } as never);
}

describe('Habits page', () => {
  it('lists habits', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
  });

  it('quick-add creates a habit with defaults', async () => {
    const createHabit = vi.fn(async () => habit({ id: 'h9' }));
    renderWithProviders(<Habits />, { api: makeApi({ createHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a habit/i), { target: { value: 'Meditate' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a habit/i), { key: 'Enter' });
    await waitFor(() => expect(createHabit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meditate', perPeriod: 3, eligibleDays: [0, 1, 2, 3, 4, 5, 6] })));
  });

  it('pause toggles status via updateHabit', async () => {
    const updateHabit = vi.fn(async () => habit());
    renderWithProviders(<Habits />, { api: makeApi({ updateHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    await waitFor(() => expect(updateHabit).toHaveBeenCalledWith('h1', { status: 'paused' }));
  });

  it('delete confirm calls deleteHabit', async () => {
    const deleteHabit = vi.fn(async () => undefined);
    renderWithProviders(<Habits />, { api: makeApi({ deleteHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    await waitFor(() => expect(deleteHabit).toHaveBeenCalledWith('h1'));
  });
});
