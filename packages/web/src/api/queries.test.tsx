import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { queryKeys, useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation } from './queries';

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
