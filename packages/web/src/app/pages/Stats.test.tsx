import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Stats } from './Stats';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'x', priority: 2, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', completedAt: null,
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
    expect(screen.getByText('Tasks done').closest('[data-testid="stat-card"]')).toHaveTextContent('1 / 2');
    expect(screen.getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute('aria-valuenow', '50');
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

  it('wraps the stat cards 2×2 below md and rows them at md+', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByText('Total scheduled')).toBeInTheDocument());
    const row = screen.getAllByTestId('stat-card')[0]!.parentElement!;
    expect(row.className).toContain('grid-cols-2');
    expect(row.className).toContain('md:flex');
  });

  it('stacks the charts vertically below md and side-by-side at md+', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByTestId('hours-by-day')).toBeInTheDocument());
    const row = screen.getByTestId('hours-by-day').parentElement!;
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('md:flex-row');
  });
});

describe('Stats page in the settings zone', () => {
  it('reports the settings-zone week (New York), not the UTC week', async () => {
    const getCalendarEvents = vi.fn(async () => []);
    const nyApi = api({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'America/New_York', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      getCalendarEvents,
      getSchedulePreview: vi.fn(async () => ({
        blocks: [
          // Sun Jan 4 22:00 New York — previous NY week (but Monday of the UTC week).
          { id: 'x1', sourceType: 'task', sourceId: 't1', title: 'A', start: Date.parse('2026-01-05T03:00:00.000Z'), end: Date.parse('2026-01-05T04:00:00.000Z') },
          // Sun Jan 11 20:00–23:00 New York — this NY week (but next UTC week).
          { id: 'x2', sourceType: 'task', sourceId: 't1', title: 'B', start: Date.parse('2026-01-12T01:00:00.000Z'), end: Date.parse('2026-01-12T04:00:00.000Z') },
        ],
        unscheduled: [],
      })),
    });
    renderWithProviders(<Stats now={() => NOW} />, { api: nyApi });
    await waitFor(() => {
      const total = screen.getByText('Total scheduled').closest('[data-testid="stat-card"]');
      expect(total).toHaveTextContent('3h');
    });
    expect(getCalendarEvents).toHaveBeenLastCalledWith('2026-01-05T05:00:00.000Z', '2026-01-12T05:00:00.000Z');
  });
});
