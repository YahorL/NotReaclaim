import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent, SchedulePreview, Task, Category } from '../../api/types';
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
    updateScheduledBlock: vi.fn(async () => blocks[0]!),
    listTasks: vi.fn(async () => [] as Task[]),
    listCategories: vi.fn(async () => [] as Category[]),
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
