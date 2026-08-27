import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Habit, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
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
    getSchedulePreview: vi.fn(async (): Promise<SchedulePreview> => ({ blocks: [], unscheduled: [] })),
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

  it('flags a habit whose occurrences could not be scheduled', async () => {
    const api = makeApi({
      getSchedulePreview: vi.fn(async (): Promise<SchedulePreview> => ({
        blocks: [],
        unscheduled: [{ sourceType: 'habit', sourceId: 'h1', title: 'Run', reason: 'could not place all habit occurrences in free time', remainingMs: 3_600_000 }],
      })),
    });
    renderWithProviders(<Habits />, { api });
    const chip = await screen.findByTestId('habit-at-risk');
    expect(chip).toHaveAttribute('title', "2 occurrences couldn't be scheduled in the planning horizon"); // 1h / 30m chunk
  });

  it('shows no chip when every occurrence fits', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    expect(screen.queryByTestId('habit-at-risk')).toBeNull();
  });

  it('delete confirm calls deleteHabit', async () => {
    const deleteHabit = vi.fn(async () => undefined);
    renderWithProviders(<Habits />, { api: makeApi({ deleteHabit }) });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    await waitFor(() => expect(deleteHabit).toHaveBeenCalledWith('h1'));
  });

  it('paints the edit overlay on the modal tier, above the tab bar', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // MobileTabBar is a fixed z-40 bar: a z-40 overlay lets its taps through to the tabs.
    expect(screen.getByTestId('habit-drawer').parentElement!.className).toContain('z-50');
  });
});

describe('Habits page compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('opens the habit drawer as a full-screen sheet', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit habit' });
    expect(sheet.className).toContain('h-dvh');
    expect(within(sheet).getByTestId('habit-drawer')).toBeInTheDocument();
  });
});
