import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import type { ScheduledBlock } from '../../api/types';
import { TopBar } from './TopBar';

// Fixed "now" = 2026-06-11T12:00:00Z
const NOW_MS = Date.parse('2026-06-11T12:00:00Z');
const nowFn = () => NOW_MS;

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null,
    ...over,
  };
}

describe('TopBar (bare render)', () => {
  function renderTopBar(onNewTask = vi.fn(), path = '/priorities') {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(
      <TopBar onNewTask={onNewTask} />,
      { api, initialEntries: [path] },
    );
    return onNewTask;
  }

  it('shows the route headline with its bold word, and the eyebrow', () => {
    renderTopBar(vi.fn(), '/priorities');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Your priorities');
    expect(h1.querySelector('strong')).toHaveTextContent('priorities');
    expect(screen.getByTestId('route-eyebrow')).toHaveTextContent(/across 4 priority levels/);
  });

  it('counts open tasks in the Priorities eyebrow', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [],
      listTasks: async () => [
        { status: 'pending' }, { status: 'scheduled' }, { status: 'backlog' }, { status: 'completed' },
      ] as never,
    });
    renderWithProviders(<TopBar onNewTask={vi.fn()} />, { api, initialEntries: ['/priorities'] });
    await waitFor(() => expect(screen.getByTestId('route-eyebrow')).toHaveTextContent('2 open tasks across 4 priority levels'));
  });

  it('shows the planner date eyebrow in the settings zone', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<TopBar onNewTask={vi.fn()} now={nowFn} />, { api, initialEntries: ['/'] });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your week planner');
    expect(screen.getByTestId('route-eyebrow')).toHaveTextContent('Thursday, June 11 · Week 24');
  });

  it('disables Search until a palette handler is wired, then calls it', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    const { unmount } = renderWithProviders(<TopBar onNewTask={vi.fn()} />, { api });
    expect(screen.getByRole('button', { name: 'Search tasks' })).toBeDisabled();
    unmount();
    const onSearch = vi.fn();
    renderWithProviders(<TopBar onNewTask={vi.fn()} onSearch={onSearch} />, { api });
    const search = screen.getByRole('button', { name: 'Search tasks' });
    expect(search).toHaveAttribute('aria-keyshortcuts', '/ Control+K Meta+K');
    fireEvent.click(search);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('fires onNewTask when New Task is clicked', () => {
    const onNewTask = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('opens the account menu to reveal Sign out', () => {
    renderTopBar();
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('the account menu closes on an outside pointerdown', () => {
    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
  });
});

describe('TopBar Next-task indicator', () => {
  // The pill lives on every route except the planner, whose Next-up card carries Start/Stop.
  it('is absent on the planner route even with a next task', async () => {
    const getSchedule = vi.fn(async () => [block()]);
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api: fakeApiClient({ getSchedule }), initialEntries: ['/'] });
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    expect(screen.queryByTestId('now-next-pill')).toBeNull();
    expect(screen.queryByTestId('next-task-start')).toBeNull();
  });

  it('shows next upcoming task title and time', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [block()],
    });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} />,
      { api, initialEntries: ['/priorities'] },
    );
    await waitFor(() =>
      expect(screen.getByTestId('next-task')).toBeInTheDocument(),
    );
    const el = screen.getByTestId('next-task');
    expect(el.textContent).toContain('Write docs');
    expect(el.textContent).toContain('Today');
  });

  it('reads "Next · <title> · <time>" with a truncating title', async () => {
    const api = fakeApiClient({ getSchedule: async () => [block({ title: 'A very long task title that must not stretch the header' })] });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    const el = await screen.findByTestId('next-task');
    expect(el.textContent).toMatch(/^Next·A very long.*·Today 2:00 PM$/);
    const title = screen.getByText(/^A very long/);
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('max-w-[24ch]');
    expect(screen.getByTestId('next-task-start')).toHaveTextContent('Start');
  });

  it('is hidden when the schedule is empty', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [],
    });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} />,
      { api, initialEntries: ['/priorities'] },
    );
    // Allow query to settle
    await waitFor(() => expect(screen.queryByTestId('next-task')).toBeNull());
  });

  it('is hidden when all blocks have no taskId (meetings only)', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [block({ taskId: null })],
    });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} />,
      { api, initialEntries: ['/priorities'] },
    );
    await waitFor(() => expect(screen.queryByTestId('next-task')).toBeNull());
  });

  it('is hidden when the only task block is in the past', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [block({ startsAt: '2026-06-11T10:00:00Z' })],
    });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} />,
      { api, initialEntries: ['/priorities'] },
    );
    await waitFor(() => expect(screen.queryByTestId('next-task')).toBeNull());
  });

  it('starts the next task block via the Start button', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => [{
        id: 'nb', userId: 'u1', title: 'Next thing',
        startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z',
        taskId: 't1', habitId: null, pinned: false, engineKey: null, startedAt: null,
      }]),
      startBlock,
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={() => Date.parse('2026-01-05T14:00:00.000Z')} />, { api, initialEntries: ['/priorities'] });
    await waitFor(() => expect(screen.getByTestId('next-task')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('next-task-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('nb'));
  });

  it('treats a just-started block whose snapped start is slightly in the future as running', async () => {
    // Start pulls the start to round15(now), which can land a few minutes ahead of now.
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'r2', startsAt: '2026-06-11T12:15:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T12:10:00Z',
      })],
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    await waitFor(() => expect(screen.getByTestId('current-task')).toBeInTheDocument());
    expect(screen.queryByTestId('next-task')).toBeNull();
  });

  // Review 13: the toggle-sidebar button is present when onToggleSidebar is provided.
  it('calls onToggleSidebar when the toggle button is clicked', () => {
    const onToggleSidebar = vi.fn();
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} onToggleSidebar={onToggleSidebar} sidebarHidden={false} />,
      { api },
    );
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('shows "Show sidebar" aria-label when sidebar is hidden', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} onToggleSidebar={() => {}} sidebarHidden={true} />,
      { api },
    );
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
  });

  it('shows "Hide sidebar" aria-label when sidebar is visible', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} onToggleSidebar={() => {}} sidebarHidden={false} />,
      { api },
    );
    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeInTheDocument();
  });

  it('announces the sidebar toggle by its action label only, never as a pressed toggle', () => {
    // A dynamic "Show/Hide sidebar" label plus aria-pressed reads as e.g. "Hide sidebar, pressed".
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(
      <TopBar onNewTask={() => {}} now={nowFn} onToggleSidebar={() => {}} sidebarHidden={false} />,
      { api },
    );
    expect(screen.getByTestId('toggle-sidebar')).not.toHaveAttribute('aria-pressed');
  });

  it('shows the running (started, in-progress) task with a Stop button', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'r1', title: 'Deep work',
        startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z',
      })],
      stopBlock,
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    await waitFor(() => expect(screen.getByTestId('current-task')).toBeInTheDocument());
    expect(screen.getByTestId('current-task').textContent).toContain('Deep work');
    expect(screen.queryByTestId('next-task')).toBeNull();
    fireEvent.click(screen.getByTestId('stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('r1'));
  });

  it('does not treat a started block whose end has passed as running', async () => {
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'done', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T09:00:00Z',
      })],
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.queryByTestId('current-task')).toBeNull());
    expect(screen.queryByTestId('next-task')).toBeNull(); // ended, and no future task
  });
});

describe('TopBar Next label in the settings zone', () => {
  it('renders the next block time in settings.timezone, not the browser zone', async () => {
    const api = fakeApiClient({
      // 02:00Z on Jun 12 is 22:00 on Jun 11 in New York (EDT) — "Today", not "Tomorrow 2:00 AM".
      getSchedule: async () => [block({ startsAt: '2026-06-12T02:00:00Z', endsAt: '2026-06-12T03:00:00Z' })],
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'America/New_York', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
    } as never);
    renderWithProviders(<TopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    await waitFor(() => expect(screen.getByTestId('next-task').textContent).toContain('Today 10:00 PM'));
  });
});

