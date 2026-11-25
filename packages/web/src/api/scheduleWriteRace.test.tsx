import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, hashKey, onlineManager, useMutation } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import {
  queryKeys,
  useScheduleQuery,
  useSchedulePreviewQuery,
  useCalendarEventsQuery,
  useTasksQuery,
  useUpdateScheduledBlockMutation,
  useDeleteScheduledBlockMutation,
  useUpdateCalendarEventMutation,
  useDeleteCalendarEventMutation,
  useUpdateTaskMutation,
  useCreateCalendarEventMutation,
} from './queries';
import { invalidateForEvent } from '../realtime/events';

// Race: a planner write is optimistic; a realtime refresh signal from an EARLIER action arriving
// while it is in flight used to refetch the schedule, read the pre-write server state and
// overwrite the optimistic value (tile jumps new → old → new; a deleted tile reappears).
// These tests drive a real QueryClient with mounted queries and hand-released writes.

type Item = { id: string; startsAt: string; endsAt: string };
const OLD = { startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' };
const NEW = { startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z' };

/** A write whose server effect is applied, and response sent, only when the test says so. */
function heldWrite<A extends unknown[]>(applyOnServer: (...args: A) => void) {
  const pending: Array<{ ok: () => void; fail: () => void }> = [];
  const fn = vi.fn(
    (...args: A) =>
      new Promise<unknown>((resolve, reject) => {
        pending.push({ ok: () => { applyOnServer(...args); resolve({}); }, fail: () => reject(new Error('500')) });
      }),
  );
  return { fn, pending };
}

function setup() {
  const server = {
    blocks: [{ id: 'b1', ...OLD }, { id: 'b2', startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z' }] as Item[],
    events: [{ id: 'e1', ...OLD }] as Item[],
  };
  const moveBlock = heldWrite((id: string, patch: Partial<Item>) => {
    server.blocks = server.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
  });
  const deleteBlock = heldWrite((id: string) => {
    server.blocks = server.blocks.filter((b) => b.id !== id);
  });
  const moveEvent = heldWrite((id: string, patch: Partial<Item>) => {
    server.events = server.events.map((e) => (e.id === id ? { ...e, ...patch } : e));
  });
  const deleteEvent = heldWrite((id: string) => {
    server.events = server.events.filter((e) => e.id !== id);
  });
  const api = {
    getSchedule: vi.fn(async () => server.blocks.map((b) => ({ ...b }))),
    getSchedulePreview: vi.fn(async () => ({ blocks: [], unscheduled: [] })),
    getCalendarEvents: vi.fn(async () => server.events.map((e) => ({ ...e }))),
    listTasks: vi.fn(async () => []),
    updateScheduledBlock: moveBlock.fn,
    deleteScheduledBlock: deleteBlock.fn,
    updateCalendarEvent: moveEvent.fn,
    deleteCalendarEvent: deleteEvent.fn,
    updateTask: vi.fn(async () => ({})),
    createCalendarEvent: vi.fn(async () => {
      server.events = [...server.events, { id: 'e2', ...NEW }];
      return {};
    }),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiProvider client={fakeApiClient(api as never)}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      schedule: useScheduleQuery('a', 'b'),
      preview: useSchedulePreviewQuery(),
      events: useCalendarEventsQuery('a', 'b'),
      tasks: useTasksQuery(),
      moveBlock: useUpdateScheduledBlockMutation(),
      deleteBlock: useDeleteScheduledBlockMutation(),
      moveEvent: useUpdateCalendarEventMutation(),
      deleteEvent: useDeleteCalendarEventMutation(),
      updateTask: useUpdateTaskMutation(),
      createEvent: useCreateCalendarEventMutation(),
    }),
    { wrapper: Wrapper },
  );
  // Every value the schedule / calendar-event list caches ever held, in order.
  const scheduleHistory: Item[][] = [];
  const eventsHistory: Item[][] = [];
  const record = (history: Item[][], hash: string) =>
    qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.query.queryHash === hash) {
        const data = e.query.state.data as Item[] | undefined;
        if (data && history[history.length - 1] !== data) history.push(data);
      }
    });
  record(scheduleHistory, hashKey(queryKeys.schedule('a', 'b')));
  record(eventsHistory, hashKey(queryKeys.calendarEvents('a', 'b')));
  const fetchers = [api.getSchedule, api.getSchedulePreview, api.getCalendarEvents, api.listTasks];
  return {
    qc, api, server, hook, Wrapper, scheduleHistory, eventsHistory,
    moveBlock: moveBlock.pending, deleteBlock: deleteBlock.pending, moveEvent: moveEvent.pending, deleteEvent: deleteEvent.pending,
    /** Wait for the initial fetches, then reset the fetch counters. */
    async ready() {
      await waitFor(() => {
        const r = hook.result.current;
        expect(r.schedule.isSuccess && r.preview.isSuccess && r.events.isSuccess && r.tasks.isSuccess).toBe(true);
      });
      fetchers.forEach((f) => f.mockClear());
      scheduleHistory.length = 0;
      eventsHistory.length = 0;
    },
  };
}

/** Let any fetches an invalidation would trigger actually start and resolve. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const b1 = (list: Item[] | undefined) => list?.find((b) => b.id === 'b1');

describe('TanStack Query contract the deferral relies on', () => {
  it('a mutation still counts as mutating inside its own onSettled (success, error, overlapping)', async () => {
    const qc = new QueryClient();
    const mutationKey = ['probe'];
    const seen: number[] = [];
    const releases: Array<(ok: boolean) => void> = [];
    const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(
      () => useMutation({
        mutationKey,
        mutationFn: () => new Promise<void>((res, rej) => releases.push((ok) => (ok ? res() : rej(new Error('x'))))),
        onSettled: () => { seen.push(qc.isMutating({ mutationKey })); },
      }),
      { wrapper: Wrapper },
    );
    act(() => { result.current.mutate(); });
    await waitFor(() => expect(releases).toHaveLength(1));
    act(() => releases[0]!(true));
    await waitFor(() => expect(seen).toEqual([1]));
    act(() => { result.current.mutate(); });
    await waitFor(() => expect(releases).toHaveLength(2));
    act(() => releases[1]!(false));
    await waitFor(() => expect(seen).toEqual([1, 1]));
    act(() => { result.current.mutate(); result.current.mutate(); });
    await waitFor(() => expect(releases).toHaveLength(4));
    act(() => releases[2]!(true));
    await waitFor(() => expect(seen).toEqual([1, 1, 2]));
    act(() => releases[3]!(false));
    await waitFor(() => expect(seen).toEqual([1, 1, 2, 1]));
  });

  it('a mutation-cache listener sees a mutation out of the pending count on its success/error update, also after clear()', async () => {
    const qc = new QueryClient();
    const mutationKey = ['probe'];
    const seen: Array<[string, number]> = [];
    qc.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && (e.action.type === 'success' || e.action.type === 'error')) {
        seen.push([e.action.type, qc.isMutating({ mutationKey })]);
      }
    });
    const releases: Array<(ok: boolean) => void> = [];
    const settled = vi.fn();
    const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(
      () => useMutation({
        mutationKey,
        mutationFn: () => new Promise<void>((res, rej) => releases.push((ok) => (ok ? res() : rej(new Error('x'))))),
        onSettled: () => { settled(); },
      }),
      { wrapper: Wrapper },
    );
    act(() => { result.current.mutate(); result.current.mutate(); });
    await waitFor(() => expect(releases).toHaveLength(2));
    // Same tick: each update is seen with only the other still pending, then none.
    await act(async () => { releases[0]!(true); releases[1]!(false); });
    await waitFor(() => expect(seen).toEqual([['success', 1], ['error', 0]]));
    // A write removed from the cache mid-flight (session swap) still settles and still reaches
    // the cache's listeners.
    act(() => { result.current.mutate(); });
    await waitFor(() => expect(releases).toHaveLength(3));
    qc.getMutationCache().clear();
    await act(async () => { releases[2]!(true); });
    await waitFor(() => expect(seen).toEqual([['success', 1], ['error', 0], ['success', 0]]));
    expect(settled).toHaveBeenCalledTimes(3);
  });

  it('a PAUSED (offline) write removed by clear() never resumes, so its onSettled never runs', async () => {
    const qc = new QueryClient();
    const mutationFn = vi.fn(async () => undefined);
    const settled = vi.fn();
    const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMutation({ mutationKey: ['probe'], mutationFn: () => mutationFn(), onSettled: () => { settled(); } }), { wrapper: Wrapper });
    try {
      onlineManager.setOnline(false);
      act(() => { result.current.mutate(); });
      await waitFor(() => expect(result.current.isPaused).toBe(true));
      qc.getMutationCache().clear();
      onlineManager.setOnline(true);
      await flush();
      expect(mutationFn).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('a refresh signal during a pending planner write', () => {
  it('(a) schedule.updated during a block move: no schedule fetch until the PATCH settles, then exactly one; the old position never reappears', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    expect(b1(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toMatchObject(NEW);

    act(() => invalidateForEvent(t.qc, { type: 'schedule.updated', userId: 'u1', counts: {} }));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();
    expect(t.api.getSchedulePreview).not.toHaveBeenCalled();
    expect(b1(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toMatchObject(NEW);

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled(); // a block write does not refetch events
    expect(t.scheduleHistory.map((l) => b1(l)?.startsAt)).not.toContain(OLD.startsAt);
    expect(b1(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toMatchObject(NEW);
  });

  it('(b) data.changed[schedule] during a block delete: the deleted block never reappears', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.deleteBlock.mutate('b1'));
    await waitFor(() => expect(t.deleteBlock).toHaveLength(1));

    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['schedule'] }));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.deleteBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.deleteBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.scheduleHistory.some((l) => b1(l))).toBe(false);
  });

  it('(b2) sync.completed during a calendar-event delete: the deleted event never reappears', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.deleteEvent.mutate('e1'));
    await waitFor(() => expect(t.deleteEvent).toHaveLength(1));

    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.deleteEvent[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.deleteEvent.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.eventsHistory.length).toBeGreaterThan(0);
    expect(t.eventsHistory.some((l) => l.some((e) => e.id === 'e1'))).toBe(false);
  });

  it('(c) two overlapping writes: the first to settle does not refetch, the last refetches each root once', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    act(() => t.hook.result.current.moveEvent.mutate({ id: 'e1', ...NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    await waitFor(() => expect(t.moveEvent).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'schedule.updated', userId: 'u1', counts: {} }));

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();

    act(() => t.moveEvent[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveEvent.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.scheduleHistory.map((l) => b1(l)?.startsAt)).not.toContain(OLD.startsAt);
  });

  it('(c2) an event write settling first keeps its calendar-event stale mark for the last (block) write to refetch', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveEvent.mutate({ id: 'e1', ...NEW }));
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveEvent).toHaveLength(1));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));

    act(() => t.moveEvent[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveEvent.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.qc.getQueryData<Item[]>(queryKeys.calendarEvents('a', 'b'))![0]).toMatchObject(NEW);
  });

  it('(c3) data.changed[calendarEvents] during a block move is refetched once the move settles', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['calendarEvents'] }));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
  });

  it('(d) a failed write rolls back and then refetches', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'schedule.updated', userId: 'u1', counts: {} }));
    act(() => t.moveBlock[0]!.fail());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isError).toBe(true));
    await flush();
    expect(b1(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toMatchObject(OLD);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
  });

  it('(d2) a write failing while another is pending defers its refetch without losing the stale mark', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveEvent.mutate({ id: 'e1', ...NEW }));
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveEvent).toHaveLength(1));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));

    act(() => t.moveEvent[0]!.fail());
    await waitFor(() => expect(t.hook.result.current.moveEvent.isError).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1); // the failed event write's truth is restored
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
  });

  it('(e) an event for a non-schedule root during a pending write refetches normally', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['tasks'] }));
    await waitFor(() => expect(t.api.listTasks).toHaveBeenCalledTimes(1));
    expect(t.api.getSchedule).not.toHaveBeenCalled();
  });

  it('(f) with nothing pending, an event refetches the schedule immediately, as before', async () => {
    const t = setup();
    await t.ready();
    act(() => invalidateForEvent(t.qc, { type: 'schedule.updated', userId: 'u1', counts: {} }));
    await waitFor(() => expect(t.api.getSchedule).toHaveBeenCalledTimes(1));
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));
    await waitFor(() => expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1));
    expect(t.api.getSchedule).toHaveBeenCalledTimes(2);
  });

  it('(g) data.changed[schedule, tasks] during a pending write: tasks refetch now, schedule waits for the settle', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['schedule', 'tasks'] }));
    await waitFor(() => expect(t.api.listTasks).toHaveBeenCalledTimes(1));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.listTasks).toHaveBeenCalledTimes(1);
  });

  it('(h) a non-planner mutation succeeding during a pending block delete refetches its own roots but defers the schedule', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.deleteBlock.mutate('b1'));
    await waitFor(() => expect(t.deleteBlock).toHaveLength(1));
    act(() => t.hook.result.current.updateTask.mutate({ id: 't1', patch: { title: 'x' } }));
    await waitFor(() => expect(t.hook.result.current.updateTask.isSuccess).toBe(true));
    await waitFor(() => expect(t.api.listTasks).toHaveBeenCalledTimes(1));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.deleteBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.deleteBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.scheduleHistory.some((l) => b1(l))).toBe(false);
  });

  it('(c4) two writes settling in the same tick still refetch each deferred root exactly once', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    act(() => t.hook.result.current.moveEvent.mutate({ id: 'e1', ...NEW }));
    await waitFor(() => { expect(t.moveBlock).toHaveLength(1); expect(t.moveEvent).toHaveLength(1); });
    t.server.events = [...t.server.events, { id: 'e3', ...NEW }];
    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();

    await act(async () => { t.moveBlock[0]!.ok(); t.moveEvent[0]!.ok(); });
    await flush();
    expect(t.qc.isMutating()).toBe(0);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.qc.getQueryData<Item[]>(queryKeys.calendarEvents('a', 'b'))!.map((e) => e.id)).toContain('e3');
  });

  it('(i) a calendar-event create succeeding during a pending block move is refetched once the move settles', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => t.hook.result.current.createEvent.mutate({ title: 'New', ...NEW }));
    await waitFor(() => expect(t.hook.result.current.createEvent.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.qc.getQueryData<Item[]>(queryKeys.calendarEvents('a', 'b'))).toHaveLength(2);
    expect(t.scheduleHistory.map((l) => b1(l)?.startsAt)).not.toContain(OLD.startsAt);
  });
});

describe('deferred refreshes are recorded explicitly, not inferred from isInvalidated', () => {
  it('(j) a signal deferred during a block move survives an older in-flight calendar-events GET resolving with pre-signal data', async () => {
    const t = setup();
    await t.ready();
    // An earlier calendar-events refetch (nothing pending yet) whose slow response reflects the
    // server state at request time.
    let releaseOld!: () => void;
    t.api.getCalendarEvents.mockImplementationOnce(() => {
      const snapshot = t.server.events.map((e) => ({ ...e }));
      return new Promise((res) => { releaseOld = () => res(snapshot); });
    });
    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['calendarEvents'] }));
    await waitFor(() => expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1));

    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    // A Google sync lands a new event and announces it while the move is pending: deferred.
    t.server.events = [...t.server.events, { id: 'e3', ...NEW }];
    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));
    await flush();
    // The old GET resolves with pre-sync data (and, in TanStack, clears isInvalidated).
    act(() => releaseOld());
    await flush();
    t.api.getCalendarEvents.mockClear();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.qc.getQueryData<Item[]>(queryKeys.calendarEvents('a', 'b'))!.map((e) => e.id)).toContain('e3');
  });

  it('(k) with nothing deferred, a block move refetches only what it did before, even with an errored calendar-events query', async () => {
    const t = setup();
    await t.ready();
    t.api.getCalendarEvents.mockImplementationOnce(async () => { throw new Error('boom'); });
    act(() => invalidateForEvent(t.qc, { type: 'data.changed', userId: 'u1', resources: ['calendarEvents'] }));
    await waitFor(() => expect(t.hook.result.current.events.isError).toBe(true));
    t.api.getCalendarEvents.mockClear();

    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
  });
});

describe('a session swap (mutation cache cleared) while a planner write is pending', () => {
  /** What AuthContext.setAuth does when a new session replaces a live one. */
  async function swapSession(t: ReturnType<typeof setup>) {
    act(() => {
      t.qc.getMutationCache().clear();
      void t.qc.resetQueries();
    });
    await flush();
    [t.api.getSchedule, t.api.getSchedulePreview, t.api.getCalendarEvents, t.api.listTasks].forEach((f) => f.mockClear());
    t.scheduleHistory.length = 0;
    t.eventsHistory.length = 0;
  }
  const b2 = (list: Item[] | undefined) => list?.find((b) => b.id === 'b2');

  it('(s1) the old write settling while the new session\'s write is pending does not refetch over the new optimistic value; both done → one refetch of each root', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    await swapSession(t);

    act(() => t.hook.result.current.deleteBlock.mutate('b2'));
    await waitFor(() => expect(t.deleteBlock).toHaveLength(1));
    expect(b2(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toBeUndefined();
    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));

    act(() => t.moveBlock[0]!.ok());
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();
    expect(t.api.getSchedulePreview).not.toHaveBeenCalled();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();
    expect(b2(t.qc.getQueryData<Item[]>(queryKeys.schedule('a', 'b')))).toBeUndefined();

    act(() => t.deleteBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.deleteBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.scheduleHistory.some((l) => b2(l))).toBe(false);
  });

  it('(s2) the old write FAILING while the new session\'s write is pending does not roll old-session data back over the new optimistic value', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    await swapSession(t);

    act(() => t.hook.result.current.deleteBlock.mutate('b2'));
    await waitFor(() => expect(t.deleteBlock).toHaveLength(1));
    act(() => t.moveBlock[0]!.fail());
    await flush();
    expect(t.scheduleHistory.some((l) => b2(l))).toBe(false);
    expect(t.api.getSchedule).not.toHaveBeenCalled();

    act(() => t.deleteBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.deleteBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.scheduleHistory.some((l) => b2(l))).toBe(false);
  });

  it('(s3) a refresh deferred behind a write that is then removed from the cache is refetched with no further mutation activity', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    act(() => invalidateForEvent(t.qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} }));
    await flush();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();

    act(() => { t.qc.getMutationCache().clear(); });
    await flush();
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
  });
});

describe('window focus / reconnect during a pending planner write', () => {
  // The real browser triggers TanStack listens for; both managers are module singletons.
  const focusWindow = () => act(() => { window.dispatchEvent(new Event('visibilitychange')); });
  const reconnect = () => act(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  it.each([
    ['focus', focusWindow],
    ['reconnect', reconnect],
  ] as const)('(l) %s during a block move: no schedule/event refetch, the tile never reverts, one refetch of each after the settle', async (_name, trigger) => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));

    trigger();
    await waitFor(() => expect(t.api.listTasks).toHaveBeenCalledTimes(1)); // other roots refetch as usual
    await flush();
    expect(t.api.getSchedule).not.toHaveBeenCalled();
    expect(t.api.getSchedulePreview).not.toHaveBeenCalled();
    expect(t.api.getCalendarEvents).not.toHaveBeenCalled();

    act(() => t.moveBlock[0]!.ok());
    await waitFor(() => expect(t.hook.result.current.moveBlock.isSuccess).toBe(true));
    await flush();
    expect(t.api.getSchedule).toHaveBeenCalledTimes(1);
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1); // recorded by the skipped refetch
    expect(t.scheduleHistory.map((l) => b1(l)?.startsAt)).not.toContain(OLD.startsAt);
  });

  it.each([
    ['focus', focusWindow],
    ['reconnect', reconnect],
  ] as const)('(m) %s with nothing pending refetches every root, as before', async (_name, trigger) => {
    const t = setup();
    await t.ready();
    trigger();
    await waitFor(() => expect(t.api.getSchedule).toHaveBeenCalledTimes(1));
    await flush();
    expect(t.api.getSchedulePreview).toHaveBeenCalledTimes(1);
    expect(t.api.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(t.api.listTasks).toHaveBeenCalledTimes(1);
  });

  it('(o) a range mounted during a pending write still fetches', async () => {
    const t = setup();
    await t.ready();
    act(() => t.hook.result.current.moveBlock.mutate({ id: 'b1', patch: NEW }));
    await waitFor(() => expect(t.moveBlock).toHaveLength(1));
    const next = renderHook(() => ({ schedule: useScheduleQuery('c', 'd'), events: useCalendarEventsQuery('c', 'd') }), { wrapper: t.Wrapper });
    await waitFor(() => expect(next.result.current.schedule.isSuccess && next.result.current.events.isSuccess).toBe(true));
    expect(t.api.getSchedule).toHaveBeenCalledWith('c', 'd');
    expect(t.api.getCalendarEvents).toHaveBeenCalledWith('c', 'd');
  });
});
