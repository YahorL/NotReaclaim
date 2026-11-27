import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import type { ScheduledBlock } from '../../api/types';
import { MobileTopBar } from './MobileTopBar';

const NOW_MS = Date.parse('2026-06-11T12:00:00Z');
const nowFn = () => NOW_MS;

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null, startedAt: null,
    ...over,
  };
}

describe('MobileTopBar', () => {
  it('shows the route title and hides itself at md and above', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    expect(screen.getByRole('heading', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByTestId('mobile-top-bar').className).toContain('md:hidden');
  });

  it('opens the New Task modal from the + button', () => {
    const onNewTask = vi.fn();
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={onNewTask} now={nowFn} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('drops the search and avatar controls', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /search/i })).toBeNull();
  });

  it('shows the next task as a truncating one-line pill with a Start button', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({ getSchedule: async () => [block()], startBlock });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.getByTestId('mobile-next-task')).toBeInTheDocument());
    const pill = screen.getByTestId('mobile-next-task');
    expect(pill.textContent).toContain('Write docs');
    expect(pill.className).toContain('truncate');
    fireEvent.click(screen.getByTestId('mobile-next-task-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('b1'));
  });

  it('shows the running task as a pill with a Stop button', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'r1', title: 'Deep work',
        startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z',
      })],
      stopBlock,
    });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.getByTestId('mobile-current-task')).toBeInTheDocument());
    expect(screen.getByTestId('mobile-current-task').textContent).toContain('Deep work');
    expect(screen.queryByTestId('mobile-next-task')).toBeNull();
    fireEvent.click(screen.getByTestId('mobile-stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('r1'));
  });

  it('a slow Start is shown busy after a short delay, and a second tap sends nothing', async () => {
    let release!: (v: unknown) => void;
    const startBlock = vi.fn(() => new Promise((res) => { release = res; }));
    const api = fakeApiClient({ getSchedule: async () => [block()], startBlock } as never);
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    const btn = await screen.findByTestId('mobile-next-task-start');
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(startBlock).toHaveBeenCalledTimes(1);
    release({});
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
  });

  it('automatic tracking: a running piece never Started shows Now with Stop', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSettings: async () => ({ requireStartToTrack: false } as never),
      getSchedule: async () => [block({ id: 'auto', title: 'Auto piece', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' })],
      stopBlock,
    });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    expect(await screen.findByTestId('mobile-current-task')).toHaveTextContent('Auto piece');
    fireEvent.click(screen.getByTestId('mobile-stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('auto'));
  });

  it('automatic: an icon button "Start next" sits beside Stop; manual has none (W1)', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const running = block({ id: 'auto', title: 'Auto piece', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' });
    const api = fakeApiClient({ getSettings: async () => ({ requireStartToTrack: false } as never), getSchedule: async () => [running, block()], startBlock });
    const { unmount } = renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    const btn = await screen.findByRole('button', { name: 'Start next: Write docs' });
    expect(btn).toHaveAttribute('data-testid', 'mobile-start-next');
    expect(btn.className).toContain('coarse:');
    fireEvent.click(btn);
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('b1'));
    unmount();
    const started = { ...running, startedAt: '2026-06-11T11:30:00Z' };
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api: fakeApiClient({ getSettings: async () => ({ requireStartToTrack: true } as never), getSchedule: async () => [started, block()] }) });
    expect(await screen.findByTestId('mobile-stop-task')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-start-next')).toBeNull();
  });

  it('gives the + button a touch-sized target', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    expect(screen.getByTestId('mobile-new-task').className).toContain('coarse:p-3');
  });
});
