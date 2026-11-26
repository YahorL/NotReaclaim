import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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

  it('a slow Start: after a short delay the button is busy (spinner), and a second click sends nothing', async () => {
    let release!: (v: unknown) => void;
    const startBlock = vi.fn(() => new Promise((res) => { release = res; }));
    const api = fakeApiClient({ getSchedule: vi.fn(async () => [block()]), startBlock } as never);
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    const btn = await screen.findByTestId('next-task-start');
    fireEvent.click(btn);
    expect(btn).not.toHaveAttribute('aria-busy');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(within(btn).getByTestId('action-pending')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(startBlock).toHaveBeenCalledTimes(1);
    release({});
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
  });

  it('a slow Stop marks the Stop button busy the same way', async () => {
    let release!: (v: unknown) => void;
    const stopBlock = vi.fn(() => new Promise((res) => { release = res; }));
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => [block({ id: 'r1', startsAt: '2026-01-05T13:30:00.000Z', endsAt: '2026-01-05T14:45:00.000Z', startedAt: '2026-01-05T13:30:00.000Z' })]),
      stopBlock,
    } as never);
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    const btn = await screen.findByTestId('stop-task');
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(stopBlock).toHaveBeenCalledTimes(1);
    release({});
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
  });

  it('automatic tracking: a piece whose time has come shows as Now with Stop, though it was never Started', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSettings: vi.fn(async () => ({ requireStartToTrack: false } as never)),
      getSchedule: vi.fn(async () => [
        block({ id: 'auto', title: 'Auto piece', startsAt: '2026-01-05T13:30:00.000Z', endsAt: '2026-01-05T14:45:00.000Z' }),
        block({ id: 'nb', title: 'Next thing' }),
      ]),
      stopBlock,
    });
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    expect(await screen.findByTestId('current-task')).toHaveTextContent('Auto piece');
    expect(screen.getByTestId('next-up-card')).toHaveTextContent('Now · until 2:45 PM');
    // No "Next … Start" as the primary action while a piece runs (same as manual mode).
    expect(screen.queryByTestId('next-task-start')).toBeNull();
    fireEvent.click(screen.getByTestId('stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('auto'));
  });

  it('manual tracking: the same never-Started piece is not running (unchanged)', async () => {
    const api = fakeApiClient({
      getSettings: vi.fn(async () => ({ requireStartToTrack: true } as never)),
      getSchedule: vi.fn(async () => [
        block({ id: 'auto', title: 'Auto piece', startsAt: '2026-01-05T13:30:00.000Z', endsAt: '2026-01-05T14:45:00.000Z' }),
        block({ id: 'nb', title: 'Next thing' }),
      ]),
    });
    renderWithProviders(<NextUpCard now={() => NOW} />, { api });
    expect(await screen.findByTestId('next-task')).toHaveTextContent('Next thing');
    expect(screen.queryByTestId('current-task')).toBeNull();
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
