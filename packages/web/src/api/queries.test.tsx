import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { ApiError } from './client';
import { fakeApiClient } from '../test/fakes';
import { queryKeys, useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useHabitsQuery, useCreateTaskMutation, useDeleteHabitMutation, useSettingsQuery, useSaveSettingsMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation, useStartBlockMutation, useStopBlockMutation, usePendingPlannerWrites } from './queries';

function wrap(api = fakeApiClient(), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  return { Wrapper, qc };
}

describe('queryKeys', () => {
  it('roots are stable prefixes', () => {
    expect(queryKeys.scheduleRoot).toEqual(['schedule']);
    expect(queryKeys.calendarEventsRoot).toEqual(['calendarEvents']);
    expect(queryKeys.tasksRoot).toEqual(['tasks']);
    expect(queryKeys.schedule('a', 'b')).toEqual(['schedule', { from: 'a', to: 'b' }]);
    expect(queryKeys.schedulePreview()).toEqual(['schedule', 'preview']);
  });
});

describe('useScheduleQuery', () => {
  it('calls getSchedule with the range and returns data', async () => {
    const getSchedule = vi.fn(async () => [{ id: 'b1' }]);
    const api = fakeApiClient({ getSchedule } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useScheduleQuery('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSchedule).toHaveBeenCalledWith('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');
    expect(result.current.data).toEqual([{ id: 'b1' }]);
  });
});

describe('useCalendarEventsQuery', () => {
  it('calls getCalendarEvents with the range and returns data', async () => {
    const getCalendarEvents = vi.fn(async () => [{ id: 'e1' }]);
    const api = fakeApiClient({ getCalendarEvents } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useCalendarEventsQuery('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getCalendarEvents).toHaveBeenCalledWith('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');
    expect(result.current.data).toEqual([{ id: 'e1' }]);
  });
});

describe('useSchedulePreviewQuery', () => {
  it('calls getSchedulePreview and returns the preview', async () => {
    const preview = { blocks: [], unscheduled: [] };
    const getSchedulePreview = vi.fn(async () => preview);
    const api = fakeApiClient({ getSchedulePreview } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useSchedulePreviewQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSchedulePreview).toHaveBeenCalled();
    expect(result.current.data).toEqual(preview);
  });
});

describe('useReplanMutation', () => {
  it('calls replan and invalidates the schedule prefix on success', async () => {
    const replan = vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 }));
    const api = fakeApiClient({ replan } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useReplanMutation(), { wrapper: Wrapper });
    result.current.mutate();
    await waitFor(() => expect(replan).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] }));
  });
});

describe('useUpdateScheduledBlockMutation', () => {
  it('calls updateScheduledBlock and invalidates the schedule prefix on success', async () => {
    const updateScheduledBlock = vi.fn(async () => ({ id: 'b1' }));
    const api = fakeApiClient({ updateScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch: { pinned: true } });
    await waitFor(() => expect(updateScheduledBlock).toHaveBeenCalledWith('b1', { pinned: true }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] }));
  });
});

describe('useHabitsQuery', () => {
  it('calls listHabits and returns data', async () => {
    const listHabits = vi.fn(async () => [{ id: 'h1' }]);
    const api = fakeApiClient({ listHabits } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useHabitsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listHabits).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'h1' }]);
  });
});

describe('useCreateTaskMutation', () => {
  it('calls createTask and invalidates tasks + schedule', async () => {
    const createTask = vi.fn(async () => ({ id: 't1' }));
    const api = fakeApiClient({ createTask } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useCreateTaskMutation(), { wrapper: Wrapper });
    result.current.mutate({ title: 'A', priority: 3, durationMs: 1, dueBy: '2026-01-01T00:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null });
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});

describe('useDeleteHabitMutation', () => {
  it('calls deleteHabit and invalidates habits + schedule', async () => {
    const deleteHabit = vi.fn(async () => undefined);
    const api = fakeApiClient({ deleteHabit } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useDeleteHabitMutation(), { wrapper: Wrapper });
    result.current.mutate('h1');
    await waitFor(() => expect(deleteHabit).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['habits'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});

describe('useSettingsQuery', () => {
  it('calls getSettings and returns data', async () => {
    const getSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ getSettings } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSettings).toHaveBeenCalled();
    expect(result.current.data).toEqual({ id: 's1' });
  });
});

describe('useSaveSettingsMutation (the Settings page)', () => {
  const input = { timezone: 'UTC', workingHours: [], defaultMinChunkMs: 1, defaultMaxChunkMs: 1, meetingBufferMs: 5, taskBufferMs: 6 };

  it('PATCHes every field but the two buffers and invalidates settings + schedule', async () => {
    const patchSettings = vi.fn(async () => ({ id: 's1' }));
    const putSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ patchSettings, putSettings } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useSaveSettingsMutation(true), { wrapper: Wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(patchSettings).toHaveBeenCalledWith({ timezone: 'UTC', workingHours: [], defaultMinChunkMs: 1, defaultMaxChunkMs: 1 }));
    expect(putSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('with no settings row yet, PUTs the whole input (buffers included)', async () => {
    const patchSettings = vi.fn(async () => ({ id: 's1' }));
    const putSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ patchSettings, putSettings } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useSaveSettingsMutation(false), { wrapper: Wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(putSettings).toHaveBeenCalledWith(input));
    expect(patchSettings).not.toHaveBeenCalled();
  });
});

describe('useCreateCalendarEventMutation', () => {
  it('posts the event and invalidates calendar events + schedule', async () => {
    const createCalendarEvent = vi.fn(async () => ({ id: 'e1' }));
    const api = fakeApiClient({ createCalendarEvent } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ title: 'Standup', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createCalendarEvent).toHaveBeenCalledWith({ title: 'Standup', startsAt: 'S', endsAt: 'E' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.calendarEventsRoot });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
  });
});

describe('useCreateScheduledBlockMutation', () => {
  it('posts the pinned block and invalidates the schedule', async () => {
    const createScheduledBlock = vi.fn(async () => ({ id: 'b9' }));
    const api = fakeApiClient({ createScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createScheduledBlock).toHaveBeenCalledWith({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
  });
});

describe('useUpdateScheduledBlockMutation optimistic update', () => {
  const block = { id: 'b1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: false };
  const patch = { startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true };
  const preview = { blocks: [], unscheduled: [] };

  it('patches cached schedule lists immediately, leaves the preview entry alone, invalidates on settle', async () => {
    let resolveReq!: (v: unknown) => void;
    const updateScheduledBlock = vi.fn(() => new Promise((res) => { resolveReq = res; }));
    const api = fakeApiClient({ updateScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block]);
    qc.setQueryData(queryKeys.schedulePreview(), preview);
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch });
    await waitFor(() => {
      const cached = qc.getQueryData<(typeof block)[]>(queryKeys.schedule('a', 'b'))!;
      expect(cached[0]).toEqual({ ...block, ...patch });
    });
    expect(qc.getQueryData(queryKeys.schedulePreview())).toEqual(preview); // non-array entry untouched
    resolveReq({ ...block, ...patch });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the cache back when the request fails', async () => {
    const updateScheduledBlock = vi.fn(async () => { throw new Error('500'); });
    const api = fakeApiClient({ updateScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block]);
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.schedule('a', 'b'))).toEqual([block]);
  });
});

describe('useDeleteScheduledBlockMutation', () => {
  const block = { id: 'b1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: false };
  const other = { id: 'b2', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', pinned: false };

  it('optimistically drops the block from cached lists, leaves the preview entry alone', async () => {
    let resolveReq!: () => void;
    const deleteScheduledBlock = vi.fn(() => new Promise<void>((res) => { resolveReq = res; }));
    const api = fakeApiClient({ deleteScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block, other]);
    qc.setQueryData(queryKeys.schedulePreview(), { blocks: [], unscheduled: [] });
    const { result } = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => {
      const cached = qc.getQueryData<(typeof block)[]>(queryKeys.schedule('a', 'b'))!;
      expect(cached).toEqual([other]);
    });
    expect(qc.getQueryData(queryKeys.schedulePreview())).toEqual({ blocks: [], unscheduled: [] });
    resolveReq();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteScheduledBlock).toHaveBeenCalledWith('b1');
  });

  it('rolls the cache back when the delete fails', async () => {
    const deleteScheduledBlock = vi.fn(async () => { throw new Error('500'); });
    const api = fakeApiClient({ deleteScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block, other]);
    const { result } = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.schedule('a', 'b'))).toEqual([block, other]);
  });
});

describe('useUpdateCalendarEventMutation', () => {
  const ev = { id: 'e1', title: 'Standup', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z', source: 'app' };
  const other = { id: 'e2', title: 'Retro', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', source: 'app' };
  const patch = { startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' };

  it('PATCHes the event and optimistically patches cached event lists, invalidating on settle', async () => {
    let resolveReq!: (v: unknown) => void;
    const updateCalendarEvent = vi.fn(() => new Promise((res) => { resolveReq = res; }));
    const api = fakeApiClient({ updateCalendarEvent } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.calendarEvents('a', 'b'), [ev, other]);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useUpdateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'e1', ...patch });
    await waitFor(() => {
      const cached = qc.getQueryData<(typeof ev)[]>(queryKeys.calendarEvents('a', 'b'))!;
      expect(cached[0]).toEqual({ ...ev, ...patch });
    });
    expect(qc.getQueryData<(typeof ev)[]>(queryKeys.calendarEvents('a', 'b'))![1]).toEqual(other); // untouched
    resolveReq({ ...ev, ...patch });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateCalendarEvent).toHaveBeenCalledWith('e1', patch);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['calendarEvents'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('rolls the cache back when the request fails', async () => {
    const updateCalendarEvent = vi.fn(async () => { throw new Error('500'); });
    const api = fakeApiClient({ updateCalendarEvent } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.calendarEvents('a', 'b'), [ev, other]);
    const { result } = renderHook(() => useUpdateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'e1', ...patch });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.calendarEvents('a', 'b'))).toEqual([ev, other]);
  });
});

describe('useDeleteCalendarEventMutation', () => {
  const ev = { id: 'e1', title: 'Standup' };
  it('optimistically removes the event and invalidates calendar + schedule on settle', async () => {
    const deleteCalendarEvent = vi.fn(async () => {});
    const api = fakeApiClient({ deleteCalendarEvent } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.calendarEvents('a', 'b'), [ev]);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useDeleteCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate('e1');
    await waitFor(() => {
      expect(qc.getQueryData(queryKeys.calendarEvents('a', 'b'))).toEqual([]);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalendarEvent).toHaveBeenCalledWith('e1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['calendarEvents'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});

describe('duplicate block writes while one is pending (U2)', () => {
  /** A request that stays pending until released; counts its calls. */
  function held<T>() {
    const releases: Array<(v: T) => void> = [];
    const fn = vi.fn(() => new Promise<T>((res) => { releases.push(res); }));
    return { fn, release: (v: T) => releases.shift()?.(v) };
  }

  it('ignores a second drop of the SAME task while its POST /schedule is pending, from any hook instance', async () => {
    const req = held<unknown>();
    const { Wrapper } = wrap(fakeApiClient({ createScheduledBlock: req.fn } as never));
    const a = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    const b = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    a.result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    a.result.current.mutate({ taskId: 't1', startsAt: 'S2', endsAt: 'E2' });
    b.result.current.mutate({ taskId: 't1', startsAt: 'S3', endsAt: 'E3' });
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(1));
    // A different task is independent.
    b.result.current.mutate({ taskId: 't2', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(2));
    req.release({ id: 'n1' });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    // Settled: the same task can be dropped again.
    a.result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(3));
  });

  it.each([
    ['Start', useStartBlockMutation, 'startBlock'],
    ['Stop', useStopBlockMutation, 'stopBlock'],
    ['delete', useDeleteScheduledBlockMutation, 'deleteScheduledBlock'],
  ] as const)('ignores a second %s on the same block while the first is pending; other blocks stay independent', async (_name, useHook, method) => {
    const req = held<unknown>();
    const { Wrapper } = wrap(fakeApiClient({ [method]: req.fn } as never));
    const topBar = renderHook(() => useHook(), { wrapper: Wrapper });
    const card = renderHook(() => useHook(), { wrapper: Wrapper });
    topBar.result.current.mutate('b1');
    card.result.current.mutate('b1');
    topBar.result.current.mutate('b1');
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(1));
    card.result.current.mutate('b2');
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(2));
    expect(req.fn).toHaveBeenNthCalledWith(2, 'b2');
    req.release(undefined);
    await waitFor(() => expect(topBar.result.current.isSuccess).toBe(true));
    topBar.result.current.mutate('b1');
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(3));
  });

  it('does NOT de-duplicate block moves: a second drag of the same block is a new edit', async () => {
    const req = held<unknown>();
    const { Wrapper } = wrap(fakeApiClient({ updateScheduledBlock: req.fn } as never));
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch: { startsAt: 'A', endsAt: 'B', pinned: true } });
    result.current.mutate({ id: 'b1', patch: { startsAt: 'C', endsAt: 'D', pinned: true } });
    await waitFor(() => expect(req.fn).toHaveBeenCalledTimes(2));
  });

  it('usePendingPlannerWrites lists what is in flight, by operation and target, across hook instances', async () => {
    const create = held<unknown>();
    const start = held<unknown>();
    const move = held<unknown>();
    const { Wrapper } = wrap(fakeApiClient({ createScheduledBlock: create.fn, startBlock: start.fn, updateScheduledBlock: move.fn } as never));
    const pending = renderHook(() => usePendingPlannerWrites(), { wrapper: Wrapper });
    expect(pending.result.current).toEqual([]);
    const c = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    const s = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    const m = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    c.result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    s.result.current.mutate('b1');
    m.result.current.mutate({ id: 'b2', patch: { pinned: false } });
    await waitFor(() => expect(pending.result.current).toHaveLength(3));
    expect(pending.result.current).toEqual(expect.arrayContaining([
      { op: 'blockCreate', target: 't1', variables: { taskId: 't1', startsAt: 'S', endsAt: 'E' } },
      { op: 'blockStart', target: 'b1', variables: 'b1' },
      { op: 'blockUpdate', target: 'b2', variables: { id: 'b2', patch: { pinned: false } } },
    ]));
    start.release(undefined);
    await waitFor(() => expect(pending.result.current).toHaveLength(2));
    expect(pending.result.current.map((p) => p.op).sort()).toEqual(['blockCreate', 'blockUpdate']);
  });
});

describe('useCreateScheduledBlockMutation: the placeholder hands over to the real tile (U1)', () => {
  it('on success writes the created row into every cached schedule list whose range it overlaps, before it stops pending', async () => {
    const created = { id: 'n1', taskId: 't1', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true };
    const createScheduledBlock = vi.fn(async () => created);
    const { Wrapper, qc } = wrap(fakeApiClient({ createScheduledBlock } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const week = queryKeys.schedule('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');
    const nextWeek = queryKeys.schedule('2026-01-12T00:00:00.000Z', '2026-01-19T00:00:00.000Z');
    const unranged = queryKeys.schedule(undefined, undefined);
    qc.setQueryData(week, [{ id: 'b1' }]);
    qc.setQueryData(nextWeek, []);
    qc.setQueryData(unranged, []);
    qc.setQueryData(queryKeys.schedulePreview(), { blocks: [], unscheduled: [] });
    let pendingWhenWritten: boolean | null = null;
    qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && pendingWhenWritten === null && JSON.stringify(e.query.queryKey) === JSON.stringify(week)) {
        pendingWhenWritten = qc.isMutating() > 0;
      }
    });
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: created.startsAt, endsAt: created.endsAt });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(week)).toEqual([{ id: 'b1' }, created]);
    expect(qc.getQueryData(nextWeek)).toEqual([]);
    expect(qc.getQueryData(unranged)).toEqual([created]);
    expect(qc.getQueryData(queryKeys.schedulePreview())).toEqual({ blocks: [], unscheduled: [] });
    expect(pendingWhenWritten).toBe(true);
  });

  it('never adds a row twice (a refetch may already have brought it)', async () => {
    const created = { id: 'n1', taskId: 't1', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true };
    const { Wrapper, qc } = wrap(fakeApiClient({ createScheduledBlock: vi.fn(async () => created) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const week = queryKeys.schedule('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');
    qc.setQueryData(week, [created]);
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: created.startsAt, endsAt: created.endsAt });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(week)).toEqual([created]);
  });
});

describe('a block write answered 404: the block no longer exists (U3)', () => {
  const b1 = { id: 'b1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: false };
  const b2 = { id: 'b2', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', pinned: false };
  const notFound = () => new ApiError(404, 'not_found', 'ScheduledBlock b1 not found');

  it('a move is not rolled back onto a block that is gone: the block leaves the cache (no flash back)', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ updateScheduledBlock: vi.fn(async () => { throw notFound(); }) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(queryKeys.schedule('a', 'b'), [b1, b2]);
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch: { startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true } });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.schedule('a', 'b'))).toEqual([b2]);
  });

  it('a delete answered 404 is not undone: the block stays gone', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ deleteScheduledBlock: vi.fn(async () => { throw notFound(); }) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(queryKeys.schedule('a', 'b'), [b1, b2]);
    const { result } = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.schedule('a', 'b'))).toEqual([b2]);
  });

  it('an app-event move answered 404 drops the event the same way', async () => {
    const e1 = { id: 'e1', startsAt: 'A', endsAt: 'B' };
    const { Wrapper, qc } = wrap(fakeApiClient({ updateCalendarEvent: vi.fn(async () => { throw notFound(); }) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(queryKeys.calendarEvents('a', 'b'), [e1]);
    const { result } = renderHook(() => useUpdateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'e1', startsAt: 'C', endsAt: 'D' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.calendarEvents('a', 'b'))).toEqual([]);
  });

  it.each([
    ['Start', useStartBlockMutation, 'startBlock'],
    ['Stop', useStopBlockMutation, 'stopBlock'],
  ] as const)('a failed %s refreshes the schedule and tasks (the top bar must not keep offering a dead block)', async (_n, useHook, method) => {
    const { Wrapper, qc } = wrap(fakeApiClient({ [method]: vi.fn(async () => { throw notFound(); }) } as never));
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useHook(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot });
  });

  it('a failed drop refreshes the schedule and the tasks (a 404 means the task is gone)', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ createScheduledBlock: vi.fn(async () => { throw new ApiError(404, 'not_found', 'Task t1 not found'); }) } as never));
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot });
  });
});

describe('a failed optimistic write rolls back only its own row (W4)', () => {
  const b1 = { id: 'b1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: false };
  const b2 = { id: 'b2', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', pinned: false };
  const key = queryKeys.schedule('2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z');
  const ids = (qc: QueryClient) => (qc.getQueryData(key) as Array<{ id: string }>).map((b) => b.id);
  const boom = () => new ApiError(500, 'internal_error', 'boom');

  it('a block created while a move was pending survives that move failing (probe P3)', async () => {
    let rejectMove!: (e: unknown) => void;
    const created = { id: 'n1', taskId: 't2', startsAt: '2026-01-05T13:00:00.000Z', endsAt: '2026-01-05T14:00:00.000Z', pinned: true };
    const { Wrapper, qc } = wrap(fakeApiClient({
      updateScheduledBlock: vi.fn(() => new Promise((_r, j) => { rejectMove = j; })),
      createScheduledBlock: vi.fn(async () => created),
    } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(key, [b1]);
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    const create = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b1', patch: { startsAt: '2026-01-05T09:30:00.000Z', endsAt: '2026-01-05T10:30:00.000Z', pinned: true } });
    await waitFor(() => expect((qc.getQueryData(key) as Array<{ startsAt: string }>)[0]!.startsAt).toBe('2026-01-05T09:30:00.000Z'));
    create.result.current.mutate({ taskId: 't2', startsAt: created.startsAt, endsAt: created.endsAt });
    await waitFor(() => expect(ids(qc)).toEqual(['b1', 'n1']));
    rejectMove(boom());
    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1, created]); // b1 back where it was, the new tile kept
  });

  it('does not resurrect a row a concurrent optimistic delete removed', async () => {
    let rejectMove!: (e: unknown) => void;
    const { Wrapper, qc } = wrap(fakeApiClient({
      updateScheduledBlock: vi.fn(() => new Promise((_r, j) => { rejectMove = j; })),
      deleteScheduledBlock: vi.fn(() => new Promise(() => {})),
    } as never));
    qc.setQueryData(key, [b1, b2]);
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    const del = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b1', patch: { pinned: true } });
    await waitFor(() => expect((qc.getQueryData(key) as typeof b1[])[0]!.pinned).toBe(true));
    del.result.current.mutate('b2');
    await waitFor(() => expect(ids(qc)).toEqual(['b1']));
    rejectMove(boom());
    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1]);
  });

  it('a failed delete puts its row back in place without undoing a concurrent move of another row', async () => {
    let rejectDelete!: (e: unknown) => void;
    const { Wrapper, qc } = wrap(fakeApiClient({
      deleteScheduledBlock: vi.fn(() => new Promise((_r, j) => { rejectDelete = j; })),
      updateScheduledBlock: vi.fn(() => new Promise(() => {})),
    } as never));
    qc.setQueryData(key, [b1, b2]);
    const del = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    del.result.current.mutate('b1');
    await waitFor(() => expect(ids(qc)).toEqual(['b2']));
    move.result.current.mutate({ id: 'b2', patch: { pinned: true } });
    await waitFor(() => expect((qc.getQueryData(key) as typeof b2[])[0]!.pinned).toBe(true));
    rejectDelete(boom());
    await waitFor(() => expect(del.result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1, { ...b2, pinned: true }]);
  });

  it('two lists: each gets only the failing row reverted; a list without that row is left alone', async () => {
    let rejectMove!: (e: unknown) => void;
    const other = queryKeys.schedule('2026-01-06T00:00:00.000Z', '2026-01-07T00:00:00.000Z');
    const { Wrapper, qc } = wrap(fakeApiClient({ updateScheduledBlock: vi.fn(() => new Promise((_r, j) => { rejectMove = j; })) } as never));
    qc.setQueryData(key, [b1, b2]);
    qc.setQueryData(other, [b2]);
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b1', patch: { pinned: true } });
    await waitFor(() => expect((qc.getQueryData(key) as typeof b1[])[0]!.pinned).toBe(true));
    // Something else changes the other list meanwhile (e.g. a created row lands there).
    const n2 = { ...b2, id: 'n2' };
    qc.setQueryData(other, [b2, n2]);
    rejectMove(boom());
    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1, b2]);
    expect(qc.getQueryData(other)).toEqual([b2, n2]);
  });
});

describe('Start / Stop write the returned row into the cache before the refetch (W5)', () => {
  const day1 = queryKeys.schedule('2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z');
  const day2 = queryKeys.schedule('2026-01-06T00:00:00.000Z', '2026-01-07T00:00:00.000Z');
  const unranged = queryKeys.schedule(undefined, undefined);
  const b5 = { id: 'b5', taskId: 't5', startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z', pinned: false, startedAt: null };

  it.each([
    ['Start', useStartBlockMutation, 'startBlock'],
    ['Stop', useStopBlockMutation, 'stopBlock'],
  ] as const)('%s: replaces the row by id in every list that covers it, while still pending', async (_n, useHook, method) => {
    const row = { ...b5, startsAt: '2026-01-05T14:15:00.000Z', endsAt: '2026-01-05T15:15:00.000Z', pinned: true, startedAt: '2026-01-05T14:10:00.000Z' };
    const { Wrapper, qc } = wrap(fakeApiClient({ [method]: vi.fn(async () => row) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(day1, [b5]);
    qc.setQueryData(unranged, [b5]);
    qc.setQueryData(day2, []);
    qc.setQueryData(queryKeys.schedulePreview(), { blocks: [], unscheduled: [] });
    let pendingWhenWritten: boolean | null = null;
    qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && pendingWhenWritten === null && JSON.stringify(e.query.queryKey) === JSON.stringify(day1)) pendingWhenWritten = qc.isMutating() > 0;
    });
    const { result } = renderHook(() => useHook(), { wrapper: Wrapper });
    result.current.mutate('b5');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(day1)).toEqual([row]);
    expect(qc.getQueryData(unranged)).toEqual([row]);
    expect(qc.getQueryData(day2)).toEqual([]);
    expect(qc.getQueryData(queryKeys.schedulePreview())).toEqual({ blocks: [], unscheduled: [] });
    expect(pendingWhenWritten).toBe(true);
  });

  it('a row whose times moved into another list leaves the old one and joins the new one', async () => {
    const moved = { ...b5, startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', startedAt: '2026-01-06T09:00:00.000Z' };
    const { Wrapper, qc } = wrap(fakeApiClient({ startBlock: vi.fn(async () => moved) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(day1, [b5]);
    qc.setQueryData(day2, []);
    const { result } = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b5');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(day1)).toEqual([]);
    expect(qc.getQueryData(day2)).toEqual([moved]);
  });

  it('an answer that is not a block row changes nothing', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ startBlock: vi.fn(async () => ({})) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(day1, [b5]);
    const { result } = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b5');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(day1)).toEqual([b5]);
  });
});

describe('useCreateScheduledBlockMutation carries the title for the placeholder only (W6c)', () => {
  it('the title stays in the mutation variables and never reaches the request body', async () => {
    const createScheduledBlock = vi.fn(async () => ({}));
    const { Wrapper } = wrap(fakeApiClient({ createScheduledBlock } as never));
    const pending = renderHook(() => usePendingPlannerWrites(), { wrapper: Wrapper });
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E', title: 'Inbox zero' });
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({ taskId: 't1', startsAt: 'S', endsAt: 'E' }));
    void pending;
  });
});

describe('event delete duplicate guard (W8)', () => {
  it('ignores a second delete of the same app event while the first is pending; another event is independent', async () => {
    const releases: Array<() => void> = [];
    const deleteCalendarEvent = vi.fn(() => new Promise<void>((res) => { releases.push(res); }));
    const { Wrapper } = wrap(fakeApiClient({ deleteCalendarEvent } as never));
    const tile = renderHook(() => useDeleteCalendarEventMutation(), { wrapper: Wrapper });
    const drawer = renderHook(() => useDeleteCalendarEventMutation(), { wrapper: Wrapper });
    tile.result.current.mutate('e1');
    drawer.result.current.mutate('e1');
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledTimes(1));
    drawer.result.current.mutate('e2');
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledTimes(2));
    releases.forEach((r) => r());
    await waitFor(() => expect(tile.result.current.isSuccess).toBe(true));
    tile.result.current.mutate('e1');
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledTimes(3));
  });
});

describe('writeBlockRow never stomps a pending optimistic edit of the same block (round 3, fix 1)', () => {
  const key = queryKeys.schedule('2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z');
  const b5 = { id: 'b5', taskId: 't5', startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z', pinned: false, startedAt: null };
  const b1 = { ...b5, id: 'b1', taskId: 't1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' };
  const startedB5 = { ...b5, startsAt: '2026-01-05T14:15:00.000Z', endsAt: '2026-01-05T15:15:00.000Z', pinned: true, startedAt: '2026-01-05T14:10:00.000Z' };
  const moved = { startsAt: '2026-01-05T18:00:00.000Z', endsAt: '2026-01-05T19:00:00.000Z', pinned: true };

  it('(a) a pending move of the SAME block: the Start answer is not written, the dragged geometry stays', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ updateScheduledBlock: vi.fn(() => new Promise(() => {})), startBlock: vi.fn(async () => startedB5) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(key, [b5]);
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    const start = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b5', patch: moved });
    await waitFor(() => expect(qc.getQueryData(key)).toEqual([{ ...b5, ...moved }]));
    start.result.current.mutate('b5');
    await waitFor(() => expect(start.result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(key)).toEqual([{ ...b5, ...moved }]);
  });

  it('(b) a pending delete of the SAME block: the Stop answer does not bring the tile back', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ deleteScheduledBlock: vi.fn(() => new Promise(() => {})), stopBlock: vi.fn(async () => startedB5) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(key, [b1, b5]);
    const del = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    const stop = renderHook(() => useStopBlockMutation(), { wrapper: Wrapper });
    del.result.current.mutate('b5');
    await waitFor(() => expect(qc.getQueryData(key)).toEqual([b1]));
    stop.result.current.mutate('b5');
    await waitFor(() => expect(stop.result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1]);
  });

  it('(c) a pending write on a DIFFERENT block does not suppress the write', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ updateScheduledBlock: vi.fn(() => new Promise(() => {})), startBlock: vi.fn(async () => startedB5) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(key, [b1, b5]);
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    const start = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b1', patch: moved });
    start.result.current.mutate('b5');
    await waitFor(() => expect(start.result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(key)).toEqual([{ ...b1, ...moved }, startedB5]);
  });

  it('(d) nothing pending: written as before', async () => {
    const { Wrapper, qc } = wrap(fakeApiClient({ startBlock: vi.fn(async () => startedB5) } as never));
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    qc.setQueryData(key, [b1, b5]);
    const start = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    start.result.current.mutate('b5');
    await waitFor(() => expect(start.result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(key)).toEqual([b1, startedB5]);
  });

  it('(e) the skipped answer is not lost: the schedule is refetched once the pending move settles', async () => {
    let finishMove!: (v: unknown) => void;
    let server: unknown[] = [b5];
    const getSchedule = vi.fn(async () => server);
    const { Wrapper, qc } = wrap(fakeApiClient({
      getSchedule,
      updateScheduledBlock: vi.fn(() => new Promise((res) => { finishMove = res; })),
      startBlock: vi.fn(async () => { server = [startedB5]; return startedB5; }),
    } as never));
    const list = renderHook(() => useScheduleQuery('2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z'), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.data).toEqual([b5]));
    const move = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    const start = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    move.result.current.mutate({ id: 'b5', patch: moved });
    await waitFor(() => expect(qc.getQueryData(key)).toEqual([{ ...b5, ...moved }]));
    start.result.current.mutate('b5');
    await waitFor(() => expect(start.result.current.isSuccess).toBe(true));
    const callsWhilePending = getSchedule.mock.calls.length;
    expect(qc.getQueryData(key)).toEqual([{ ...b5, ...moved }]);
    finishMove({ ...b5, ...moved });
    await waitFor(() => expect(getSchedule.mock.calls.length).toBeGreaterThan(callsWhilePending));
    await waitFor(() => expect(list.result.current.data).toEqual([startedB5]));
  });
});
