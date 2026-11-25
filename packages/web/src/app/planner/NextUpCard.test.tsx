import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledBlock } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NextUpCard, followingBlock } from './NextUpCard';

const NOW = Date.parse('2026-01-05T14:00:00.000Z'); // Monday 14:00 (TZ=UTC)

const block = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
  id: 'nb', userId: 'u1', title: 'Next thing',
  startsAt: '2026-01-05T15:29:00.000Z', endsAt: '2026-01-05T16:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: null, startedAt: null, ...over,
});

describe('NextUpCard', () => {
  it('shows the next task block, when it starts and a Start button', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({ getSchedule: vi.fn(async () => [block()]), startBlock });
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    expect(await screen.findByTestId('next-task')).toHaveTextContent('Next thing');
    const card = screen.getByTestId('next-up-card');
    expect(card).toHaveTextContent('Next up · Today 3:29 PM');
    expect(card).toHaveTextContent('in 1h 29m');
    fireEvent.click(screen.getByTestId('next-task-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('nb'));
  });

  it('shows the running task with a Stop button', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => [block({ id: 'r1', title: 'Doing it', startsAt: '2026-01-05T13:30:00.000Z', endsAt: '2026-01-05T14:45:00.000Z', startedAt: '2026-01-05T13:30:00.000Z' })]),
      stopBlock,
    });
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    expect(await screen.findByTestId('current-task')).toHaveTextContent('Doing it');
    expect(screen.getByTestId('next-up-card')).toHaveTextContent('Now · until 2:45 PM');
    expect(screen.getByTestId('next-up-card')).toHaveTextContent('45m left');
    expect(screen.queryByTestId('next-task-start')).toBeNull();
    fireEvent.click(screen.getByTestId('stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('r1'));
  });

  it('names the block after the next one on its second line', async () => {
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => [block(), block({ id: 'b2', title: 'Then this', taskId: 't2', startsAt: '2026-01-06T16:30:00.000Z', endsAt: '2026-01-06T17:00:00.000Z' })]),
    });
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    expect(await screen.findByTestId('next-up-following')).toHaveTextContent('Tomorrow 4:30 PM · Then this');
  });

  it('empty state when nothing is scheduled next', async () => {
    const getSchedule = vi.fn(async () => [] as ScheduledBlock[]);
    renderWithProviders(<NextUpCard now={() => NOW} />, { api: fakeApiClient({ getSchedule }) });
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    expect(screen.getByTestId('next-up-card')).toHaveTextContent('Nothing scheduled next');
    expect(screen.queryByTestId('next-task-start')).toBeNull();
    expect(screen.queryByTestId('stop-task')).toBeNull();
  });
});

describe('followingBlock', () => {
  it('picks the soonest block starting after the reference, excluding it', () => {
    const ref = block({ id: 'ref', startsAt: '2026-01-05T10:00:00.000Z' });
    const later = block({ id: 'later', startsAt: '2026-01-05T12:00:00.000Z' });
    const soon = block({ id: 'soon', startsAt: '2026-01-05T11:00:00.000Z', habitId: 'h1', taskId: null });
    const before = block({ id: 'before', startsAt: '2026-01-05T09:00:00.000Z' });
    expect(followingBlock([later, ref, before, soon], ref)?.id).toBe('soon');
    expect(followingBlock([ref, before], ref)).toBeNull();
  });
});
