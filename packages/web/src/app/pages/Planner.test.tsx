import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent, SchedulePreview, PreviewBlock } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Planner } from './Planner';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const blocks: ScheduledBlock[] = [{
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-07T13:00:00.000Z', endsAt: '2026-01-07T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0',
}];
const events: CalendarEvent[] = [{
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1',
}];
const preview: SchedulePreview = {
  blocks: [],
  unscheduled: [{ sourceType: 'task', sourceId: 't9', title: 'Tax filing', reason: 'no free time before due', remainingMs: 3600000 }],
};

function makeApi(over = {}) {
  return fakeApiClient({
    getSchedule: vi.fn(async () => blocks),
    getCalendarEvents: vi.fn(async () => events),
    getSchedulePreview: vi.fn(async () => preview),
    replan: vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 })),
    ...over,
  } as never);
}

describe('Planner', () => {
  it('renders blocks, meetings, and at-risk items', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Tax filing')).toBeInTheDocument();
  });

  it('clicking Re-plan calls api.replan', async () => {
    const replan = vi.fn(async () => ({ created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 }));
    const api = makeApi({ replan });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    await waitFor(() => expect(replan).toHaveBeenCalledTimes(1));
  });

  it('shows proposed blocks on the grid by default and the Proposed toggle hides them', async () => {
    const proposed: PreviewBlock[] = [
      { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'Proposed focus',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
    ];
    const api = makeApi({ getSchedulePreview: vi.fn(async () => ({ blocks: proposed, unscheduled: [] })) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Proposed focus')).toBeInTheDocument());
    const ghost = screen.getByText('Proposed focus').closest('[data-testid="event-block"]');
    expect(ghost).toHaveAttribute('data-proposed', 'true');
    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.queryByText('Proposed focus')).toBeNull();
  });

  it('does not draw a proposed ghost for a block already committed (same engineKey)', async () => {
    const committed: ScheduledBlock[] = [{
      id: 'b1', userId: 'u1', title: 'Committed task',
      startsAt: '2026-01-07T13:00:00.000Z', endsAt: '2026-01-07T14:00:00.000Z',
      taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0',
    }];
    const proposed: PreviewBlock[] = [
      { id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Committed task',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
      { id: 'task:t2:0', sourceType: 'task', sourceId: 't2', title: 'Only proposed',
        start: Date.parse('2026-01-07T15:00:00.000Z'), end: Date.parse('2026-01-07T16:00:00.000Z') },
    ];
    const api = makeApi({
      getSchedule: vi.fn(async () => committed),
      getSchedulePreview: vi.fn(async () => ({ blocks: proposed, unscheduled: [] })),
    });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Committed task')).toBeInTheDocument());
    // committed block renders solid; no proposed ghost duplicates it
    expect(screen.getAllByText('Committed task')).toHaveLength(1);
    // a not-yet-committed proposed block still renders as a ghost
    const ghost = screen.getByText('Only proposed').closest('[data-testid="event-block"]');
    expect(ghost).toHaveAttribute('data-proposed', 'true');
  });

  it('navigating to the next week refetches with a new range', async () => {
    const getSchedule = vi.fn(async () => blocks);
    const api = makeApi({ getSchedule });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1));
    const firstFrom = (getSchedule.mock.calls[0]! as unknown[])[0];
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2));
    const secondFrom = (getSchedule.mock.calls[1]! as unknown[])[0];
    expect(secondFrom).not.toBe(firstFrom);
  });
});
