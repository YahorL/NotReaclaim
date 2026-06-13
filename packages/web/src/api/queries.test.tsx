import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { queryKeys, useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useHabitsQuery, useCreateTaskMutation, useDeleteHabitMutation, useSettingsQuery, useUpdateSettingsMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation } from './queries';

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

describe('useUpdateSettingsMutation', () => {
  it('calls putSettings and invalidates settings + schedule', async () => {
    const putSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ putSettings } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useUpdateSettingsMutation(), { wrapper: Wrapper });
    result.current.mutate({ timezone: 'UTC', workingHours: [], defaultMinChunkMs: 1, defaultMaxChunkMs: 1 });
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
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
