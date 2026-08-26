import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent, SchedulePreview, Task, Category, Habit } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Planner } from './Planner';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const blocks: ScheduledBlock[] = [{
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-07T13:00:00.000Z', endsAt: '2026-01-07T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0',
}];
const events: CalendarEvent[] = [{
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1', source: 'google',
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
    updateScheduledBlock: vi.fn(async () => blocks[0]!),
    listTasks: vi.fn(async () => [] as Task[]),
    listCategories: vi.fn(async () => [] as Category[]),
    listHabits: vi.fn(async () => [] as Habit[]),
    ...over,
  } as never);
}

describe('Planner', () => {
  it('renders blocks and meetings', async () => {
    const api = makeApi(); // listTasks → [] so the task panel is empty (no duplicate titles)
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument();
  });

  it('clicking Re-plan calls api.replan', async () => {
    const replan = vi.fn(async () => ({ created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 }));
    const api = makeApi({ replan });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    await waitFor(() => expect(replan).toHaveBeenCalledTimes(1));
  });

  it('navigating to the next week refetches with a new range', async () => {
    // NOW = 2026-01-07T12:00:00Z (Wednesday); TZ=UTC. useElementWidth starts at -1 and jsdom has
    // no ResizeObserver, so it stays -1 → daysThatFit(-1) = 7 (full week window).
    // initial from=2026-01-07T00:00:00.000Z, to=2026-01-14T00:00:00.000Z
    // after Next: from=2026-01-14T00:00:00.000Z, to=2026-01-21T00:00:00.000Z
    const getSchedule = vi.fn(async () => blocks);
    const api = makeApi({ getSchedule });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1));
    expect((getSchedule.mock.calls[0]! as unknown[])[0]).toBe('2026-01-07T00:00:00.000Z');
    expect((getSchedule.mock.calls[0]! as unknown[])[1]).toBe('2026-01-14T00:00:00.000Z');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2));
    expect((getSchedule.mock.calls[1]! as unknown[])[0]).toBe('2026-01-14T00:00:00.000Z');
    expect((getSchedule.mock.calls[1]! as unknown[])[1]).toBe('2026-01-21T00:00:00.000Z');
  });

  it('block label shows "Task: subtask" when task has an open subtask', async () => {
    const taskWithSubtask: Task = {
      id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
      durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
      categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '',
      subtasks: [{ id: 's1', taskId: 't1', title: 'outline', done: false, sortOrder: 0 }],
    };
    const api = makeApi({ listTasks: vi.fn(async () => [taskWithSubtask]) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec: outline')).toBeInTheDocument());
  });

  it('dragging a task from the panel onto a day column creates a pinned block at the slot', async () => {
    const createScheduledBlock = vi.fn(async () => blocks[0]!);
    const taskRow: Task = {
      id: 't1', userId: 'u1', title: 'Deep work', priority: 2, sortOrder: 0,
      durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
      categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '', subtasks: [],
    };
    const api = makeApi({ listTasks: vi.fn(async () => [taskRow]), createScheduledBlock });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Deep work')).toBeInTheDocument()); // task loaded into the panel
    const col = screen.getByTestId('day-col-0'); // today 2026-01-07 (TZ=UTC); jsdom 0-height → 00:00 slot
    const dt = { types: ['application/x-nr-task'], getData: (t: string) => (t === 'application/x-nr-task' ? 't1' : ''), dropEffect: '' };
    fireEvent.drop(col, { clientY: 100, dataTransfer: dt });
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledTimes(1));
    expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't1',
      startsAt: '2026-01-07T00:00:00.000Z',
      endsAt: '2026-01-07T01:00:00.000Z',
    });
  });

  it('hides and re-shows the right task panel', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-hide'));
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('panel-show'));
    expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument();
  });

  it('clicking an app-created event opens the event edit drawer, prefilled', async () => {
    const appEvent: CalendarEvent = {
      id: 'e9', userId: 'u1', title: 'Coffee',
      startsAt: '2026-01-07T15:00:00.000Z', endsAt: '2026-01-07T15:30:00.000Z',
      googleCalendarId: null, googleEventId: null, source: 'app',
    };
    const api = makeApi({ getCalendarEvents: vi.fn(async () => [appEvent]) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    expect(screen.queryByTestId('event-drawer')).toBeNull();
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Coffee'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(screen.getByTestId('event-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('event-title')).toHaveValue('Coffee');
    expect(screen.getByTestId('event-start')).toHaveValue('2026-01-07T15:00'); // TZ=UTC settings default
  });

  it('saving a time edit from the event drawer PATCHes the new start and closes the drawer', async () => {
    // Regression: the drawer is keyed on the event's times, and the update mutation patches the
    // cached event optimistically — so closing on the mutation's onSuccess never fired (the key
    // change unmounted the drawer, and its mutation observer, first). Save closes synchronously.
    const appEvent: CalendarEvent = {
      id: 'e9', userId: 'u1', title: 'Coffee',
      startsAt: '2026-01-07T15:00:00.000Z', endsAt: '2026-01-07T15:30:00.000Z',
      googleCalendarId: null, googleEventId: null, source: 'app',
    };
    const updateCalendarEvent = vi.fn(async () => appEvent);
    const api = makeApi({ getCalendarEvents: vi.fn(async () => [appEvent]), updateCalendarEvent });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Coffee'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    // pull the start earlier (the end stays 15:30, so the range stays valid and Save is enabled)
    fireEvent.change(screen.getByTestId('event-start'), { target: { value: '2026-01-07T14:00' } });
    fireEvent.click(screen.getByTestId('event-save'));
    expect(screen.queryByTestId('event-drawer')).toBeNull();
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledWith('e9', { startsAt: '2026-01-07T14:00:00.000Z' }));
  });

  it('renders the schedule range query for the settings timezone', async () => {
    // with NY zone, today's column start is NY midnight (04:00Z in EDT; but NOW is Jan, so EST UTC-5 → 05:00Z)
    const getSchedule = vi.fn(async () => blocks);
    const api = makeApi({ getSchedule, getSettings: async () => ({ id:'s', userId:'u1', timezone:'America/New_York', workingHours:[], horizonDays:14, defaultMinChunkMs:1, defaultMaxChunkMs:1, meetingBufferMs:0, taskBufferMs:0, createdAt:'', updatedAt:'' } as never) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    // Wait until the planner re-anchors after settings load: the NY-zone from must be 05:00Z (EST UTC-5)
    await waitFor(() => {
      const calls = getSchedule.mock.calls as unknown[][];
      expect(calls.some((c) => c[0] === '2026-01-07T05:00:00.000Z')).toBe(true);
    });
  });

  it('anchors the planner to the configured day start (01:30 sits on the previous date column)', async () => {
    const LATE = Date.parse('2026-01-07T01:30:00.000Z');
    const getSchedule = vi.fn(async () => [] as ScheduledBlock[]);
    const api = makeApi({
      getSchedule,
      getCalendarEvents: vi.fn(async () => [] as CalendarEvent[]),
      getSettings: async () => ({ id: 's', userId: 'u1', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1, defaultMaxChunkMs: 1, meetingBufferMs: 0, taskBufferMs: 0, dayStartMinute: 180, createdAt: '', updatedAt: '' } as never),
    });
    renderWithProviders(<Planner now={() => LATE} />, { api });
    await waitFor(() => {
      const calls = getSchedule.mock.calls as unknown[][];
      expect(calls.some((c) => c[0] === '2026-01-06T03:00:00.000Z' && c[1] === '2026-01-13T03:00:00.000Z')).toBe(true);
    });
    // the first column is Jan 6 (yesterday's date) and it is "today" at 01:30
    expect(screen.getByTestId('day-header-0').dataset.today).toBe('true');
    expect(screen.getByTestId('day-header-0').textContent).toMatch(/6/);
    // and the hour gutter starts at the day-start hour
    expect(screen.getByTestId('hour-gutter').textContent!.startsWith('3a')).toBe(true);
  });

  it('warns above the grid about what could not be scheduled, naming tasks and habits', async () => {
    const habit: Habit = {
      id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
      periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
      status: 'active', createdAt: '', updatedAt: '',
    };
    const api = makeApi({
      listHabits: vi.fn(async () => [habit]),
      getSchedulePreview: vi.fn(async (): Promise<SchedulePreview> => ({
        blocks: [],
        unscheduled: [
          { sourceType: 'task', sourceId: 't9', title: 'Tax filing', reason: 'no free time before due', remainingMs: 3_600_000 },
          { sourceType: 'habit', sourceId: 'h1', title: 'Run', reason: 'could not place all habit occurrences in free time', remainingMs: 3_600_000 },
        ],
      })),
    });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    const banner = await screen.findByTestId('unscheduled-warning');
    expect(banner).toHaveTextContent("Couldn't schedule everything:");
    expect(banner).toHaveTextContent('Tax filing (1h left)');
    expect(banner).toHaveTextContent('Run (2 missed)'); // 1h remaining / 30m chunk
  });

  it('shows no warning when the preview schedules everything', async () => {
    const api = makeApi({ getSchedulePreview: vi.fn(async (): Promise<SchedulePreview> => ({ blocks: [], unscheduled: [] })) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.queryByTestId('unscheduled-warning')).toBeNull();
  });

  it('task block is tinted when its category has a color', async () => {
    // blocks[0] has taskId:'t1'; task has categoryId:'cat-1'; category has color:'#5b62e3'
    const task: Task = {
      id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
      durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
      categoryId: 'cat-1', status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '',
    };
    const category: Category = { id: 'cat-1', userId: 'u1', name: 'Deep Work', windows: null, color: '#5b62e3', isDefault: false };
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => blocks),
      getCalendarEvents: vi.fn(async () => events),
      getSchedulePreview: vi.fn(async () => preview),
      replan: vi.fn(async () => ({ created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 })),
      updateScheduledBlock: vi.fn(async () => blocks[0]!),
      listTasks: vi.fn(async () => [task]),
      listCategories: vi.fn(async () => [category]),
      listHabits: vi.fn(async () => [] as Habit[]),
    } as never);
    renderWithProviders(<Planner now={() => NOW} />, { api });
    // 'Write spec' now also shows in the task panel, so wait on the block instead of getByText
    await waitFor(() => expect(screen.getAllByTestId('event-block').length).toBeGreaterThan(0));
    const taskBlock = screen.getAllByTestId('event-block').find(
      (b) => b.getAttribute('data-kind') === 'task',
    )!;
    // Movable task → borderColor tinted
    expect(taskBlock.style.borderColor).toBe('rgb(91, 98, 227)');
  });
});

describe('Planner compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('does not render the task panel inline; the Tasks button opens it as a sheet', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
    const toggle = screen.getByTestId('panel-sheet-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('dialog', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-sheet-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the task sheet on a backdrop tap', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-sheet-toggle'));
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
  });
});
