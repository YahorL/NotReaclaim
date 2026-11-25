import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, hashKey, useMutation } from '@tanstack/react-query';
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
  const api = {
    getSchedule: vi.fn(async () => server.blocks.map((b) => ({ ...b }))),
    getSchedulePreview: vi.fn(async () => ({ blocks: [], unscheduled: [] })),
    getCalendarEvents: vi.fn(async () => server.events.map((e) => ({ ...e }))),
    listTasks: vi.fn(async () => []),
    updateScheduledBlock: moveBlock.fn,
    deleteScheduledBlock: deleteBlock.fn,
    updateCalendarEvent: moveEvent.fn,
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
    }),
    { wrapper: Wrapper },
  );
  // Every value the schedule list cache ever held, in order.
  const scheduleHistory: Item[][] = [];
  qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.query.queryHash === hashKey(queryKeys.schedule('a', 'b'))) {
      const data = e.query.state.data as Item[] | undefined;
      if (data && scheduleHistory[scheduleHistory.length - 1] !== data) scheduleHistory.push(data);
    }
  });
  const fetchers = [api.getSchedule, api.getSchedulePreview, api.getCalendarEvents, api.listTasks];
  return {
    qc, api, server, hook, scheduleHistory,
    moveBlock: moveBlock.pending, deleteBlock: deleteBlock.pending, moveEvent: moveEvent.pending,
    /** Wait for the initial fetches, then reset the fetch counters. */
    async ready() {
      await waitFor(() => {
        const r = hook.result.current;
        expect(r.schedule.isSuccess && r.preview.isSuccess && r.events.isSuccess && r.tasks.isSuccess).toBe(true);
      });
      fetchers.forEach((f) => f.mockClear());
      scheduleHistory.length = 0;
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
});
