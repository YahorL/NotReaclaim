import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Stats } from './Stats';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'x', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const populatedPreview: SchedulePreview = {
  blocks: [
    { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'A', start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T15:00:00.000Z') },
    { id: 'p2', sourceType: 'habit', sourceId: 'h1', title: 'B', start: Date.parse('2026-01-05T08:00:00.000Z'), end: Date.parse('2026-01-05T09:00:00.000Z') },
  ],
  unscheduled: [],
};

function api(over = {}) {
  return fakeApiClient({
    getSchedulePreview: vi.fn(async () => populatedPreview),
    getCalendarEvents: vi.fn(async () => []),
    listTasks: vi.fn(async () => [task({ status: 'completed' }), task({ id: 't2', status: 'pending' })]),
    ...over,
  } as never);
}

describe('Stats page', () => {
  it('renders summary cards and charts from the proposed plan', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByText('Total scheduled')).toBeInTheDocument());
    expect(screen.getByText('Task time')).toBeInTheDocument();
    expect(screen.getByText('Tasks done')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByTestId('hours-by-day')).toBeInTheDocument();
    expect(screen.getByTestId('time-split')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is scheduled and no tasks exist', async () => {
    const empty = api({
      getSchedulePreview: vi.fn(async () => ({ blocks: [], unscheduled: [] })),
      listTasks: vi.fn(async () => []),
    });
    renderWithProviders(<Stats now={() => NOW} />, { api: empty });
    await waitFor(() => expect(screen.getByText(/nothing scheduled yet/i)).toBeInTheDocument());
    expect(screen.queryByText('Total scheduled')).toBeNull();
  });
});
