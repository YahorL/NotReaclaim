import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { useWebSocket, type SocketLike } from './useWebSocket';
import { ApiProvider } from '../api/ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { useScheduleQuery, useTasksQuery, useUpdateScheduledBlockMutation } from '../api/queries';

class FakeSocket implements SocketLike {
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  closed = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev: unknown) {
    (this.listeners[type] ?? []).forEach((fn) => fn(ev));
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useWebSocket', () => {
  it('invalidates query keys when a server event arrives', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const socket = new FakeSocket();

    renderHook(() => useWebSocket({ token: 'jwt', makeSocket: () => socket }), { wrapper: wrapper(qc) });
    socket.emit('message', { data: JSON.stringify({ type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' }) });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('maps a data.changed frame to its query roots', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const socket = new FakeSocket();

    renderHook(() => useWebSocket({ token: 'jwt', makeSocket: () => socket }), { wrapper: wrapper(qc) });
    socket.emit('message', { data: JSON.stringify({ type: 'data.changed', userId: 'u1', resources: ['habits', 'schedule'] }) });

    expect(spy.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey)).toEqual([['habits'], ['schedule']]);
  });

  it('ignores frames of an unknown event type (and non-object JSON) and keeps handling later ones', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const socket = new FakeSocket();

    renderHook(() => useWebSocket({ token: 'jwt', makeSocket: () => socket }), { wrapper: wrapper(qc) });
    expect(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'future.thing', userId: 'u1', payload: 1 }) });
      socket.emit('message', { data: 'null' });
      socket.emit('message', { data: '42' });
    }).not.toThrow();
    expect(spy).not.toHaveBeenCalled();

    socket.emit('message', { data: JSON.stringify({ type: 'schedule.updated', userId: 'u1', counts: {} }) });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('does not connect without a token', () => {
    const qc = new QueryClient();
    const makeSocket = vi.fn(() => new FakeSocket());
    renderHook(() => useWebSocket({ token: null, makeSocket }), { wrapper: wrapper(qc) });
    expect(makeSocket).not.toHaveBeenCalled();
  });

  it('reconnects after an unexpected close', () => {
    const qc = new QueryClient();
    const sockets: FakeSocket[] = [];
    const makeSocket = vi.fn(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    expect(makeSocket).toHaveBeenCalledTimes(1);

    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    expect(makeSocket).toHaveBeenCalledTimes(2);
  });

  it('closes the socket on unmount without reconnecting', () => {
    const qc = new QueryClient();
    const makeSocket = vi.fn(() => new FakeSocket());
    const { unmount } = renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    unmount();
    vi.advanceTimersByTime(5000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
  });

  it('sign-out (token → null) closes the socket and cancels a pending reconnect with the old token', () => {
    const qc = new QueryClient();
    const sockets: FakeSocket[] = [];
    const makeSocket = vi.fn((_url: string) => { const s = new FakeSocket(); sockets.push(s); return s; });
    const { rerender } = renderHook(({ token }) => useWebSocket({ token, makeSocket }), {
      wrapper: wrapper(qc), initialProps: { token: 'jwt-a' as string | null },
    });
    rerender({ token: null });
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.emit('close', {}); // the close event the real socket fires afterwards
    vi.advanceTimersByTime(5000);
    expect(makeSocket).toHaveBeenCalledTimes(1);

    // A drop that scheduled a reconnect, then sign-out before it fires: no reconnect as A.
    rerender({ token: 'jwt-a' });
    sockets[1]!.emit('close', {});
    rerender({ token: null });
    vi.advanceTimersByTime(5000);
    expect(makeSocket).toHaveBeenCalledTimes(2);
  });

  it('uses a stable default socket factory (no reconnect on re-render)', () => {
    const qc = new QueryClient();
    const ctor = vi.fn(() => ({ addEventListener() {}, close() {} }));
    vi.stubGlobal('WebSocket', ctor);
    try {
      const { rerender } = renderHook(() => useWebSocket({ token: 'jwt' }), { wrapper: wrapper(qc) });
      rerender();
      rerender();
      expect(ctor).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** Every root a realtime event can refresh (see `events.ts`), as `invalidateQueries` sees them. */
const ALL_ROOTS = ['calendarEvents', 'categories', 'googleStatus', 'habits', 'schedule', 'settings', 'tasks'];
const invalidatedRoots = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([f]) => ((f as { queryKey: string[] }).queryKey)[0]!).sort();

function socketFactory() {
  const sockets: FakeSocket[] = [];
  const makeSocket = vi.fn((_url: string) => { const s = new FakeSocket(); sockets.push(s); return s; });
  return { sockets, makeSocket };
}

describe('useWebSocket: catching up after the connection comes back', () => {
  it('does not refetch on the first open (the page has just fetched everything)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('a drop + reopen invalidates every event root exactly once', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    expect(spy).not.toHaveBeenCalled(); // the drop itself does nothing; the reopen does
    sockets[1]!.emit('open', {});
    expect(invalidatedRoots(spy)).toEqual(ALL_ROOTS);
  });

  it('a failed reconnect attempt refetches nothing; the attempt that opens refetches once', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[1]!.emit('close', {}); // server still down: never opened
    vi.advanceTimersByTime(2000);
    expect(spy).not.toHaveBeenCalled();
    sockets[2]!.emit('open', {});
    expect(invalidatedRoots(spy)).toEqual(ALL_ROOTS);
  });

  it('two reopens within 15 s: the first refreshes at once, the second at the end of the 15 s window', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    for (let i = 1; i <= 2; i++) {
      sockets[i - 1]!.emit('close', {});
      vi.advanceTimersByTime(2000);
      sockets[i]!.emit('open', {});
    }
    expect(invalidatedRoots(spy)).toEqual(ALL_ROOTS);
    vi.advanceTimersByTime(12_999);
    expect(invalidatedRoots(spy)).toEqual(ALL_ROOTS);
    vi.advanceTimersByTime(1); // 15 s after the first refresh
    expect(invalidatedRoots(spy)).toEqual([...ALL_ROOTS, ...ALL_ROOTS].sort());
  });

  it('a connection flapping every 2 s for 60 s refreshes about every 15 s, not on each of the 30 reopens', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    for (let i = 1; i <= 30; i++) {
      sockets[i - 1]!.emit('close', {}); // opened, then closed at once (idle timeout, flaky proxy)
      vi.advanceTimersByTime(2000);
      sockets[i]!.emit('open', {});
    }
    vi.advanceTimersByTime(15_000);
    const refreshes = spy.mock.calls.length / ALL_ROOTS.length;
    expect(refreshes).toBeGreaterThanOrEqual(4);
    expect(refreshes).toBeLessThanOrEqual(5);
  });

  it('the trailing refresh runs once, and only if the socket is open when the window ends', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    sockets[0]!.emit('open', {});
    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[1]!.emit('open', {}); // refresh #1, window opens
    sockets[1]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[2]!.emit('open', {}); // swallowed
    sockets[2]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[3]!.emit('open', {}); // swallowed again
    expect(spy.mock.calls.length / ALL_ROOTS.length).toBe(1);
    vi.advanceTimersByTime(11_000); // 15 s after refresh #1 (t = 2 s → 17 s)
    expect(spy.mock.calls.length / ALL_ROOTS.length).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(spy.mock.calls.length / ALL_ROOTS.length).toBe(2);

    // A swallowed reopen whose socket is down again when the window ends: no trailing refresh;
    // the next reopen (outside any window) refreshes at once.
    sockets[3]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[4]!.emit('open', {}); // refresh #3, window opens
    sockets[4]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[5]!.emit('open', {}); // swallowed
    sockets[5]!.emit('close', {});
    vi.advanceTimersByTime(13_000); // window ends while the socket is down
    expect(spy.mock.calls.length / ALL_ROOTS.length).toBe(3);
    sockets[6]!.emit('open', {});
    expect(spy.mock.calls.length / ALL_ROOTS.length).toBe(4);
  });

  it('a swallowed reopen never refreshes after unmount or a token change, and leaves no timer behind', () => {
    for (const end of ['unmount', 'token'] as const) {
      const qc = new QueryClient();
      const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
      const { sockets, makeSocket } = socketFactory();
      const { rerender, unmount } = renderHook(({ token }) => useWebSocket({ token, makeSocket }), {
        wrapper: wrapper(qc), initialProps: { token: 'jwt-a' as string | null },
      });
      sockets[0]!.emit('open', {});
      sockets[0]!.emit('close', {});
      vi.advanceTimersByTime(2000);
      sockets[1]!.emit('open', {}); // refresh, window opens
      sockets[1]!.emit('close', {});
      vi.advanceTimersByTime(2000);
      sockets[2]!.emit('open', {}); // swallowed: a trailing refresh is due
      spy.mockClear();
      if (end === 'unmount') {
        unmount();
        expect(vi.getTimerCount()).toBe(0);
      } else {
        rerender({ token: 'jwt-b' });
      }
      vi.advanceTimersByTime(60_000);
      expect(spy).not.toHaveBeenCalled();
      if (end === 'token') {
        unmount();
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  });

  it('StrictMode\'s mount → cleanup → remount is not a reconnect, even if the never-opened discarded socket opens late', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    const strict = ({ children }: { children: ReactNode }) => (
      <StrictMode><QueryClientProvider client={qc}>{children}</QueryClientProvider></StrictMode>
    );
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: strict });
    expect(sockets).toHaveLength(2); // the double mount really happened
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.emit('open', {}); // a discarded socket that opened anyway
    sockets[1]!.emit('open', {});
    expect(spy).not.toHaveBeenCalled();

    // The surviving socket still catches up after a real drop.
    sockets[1]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    sockets[2]!.emit('open', {});
    expect(invalidatedRoots(spy)).toEqual(ALL_ROOTS);
  });

  it('a late open on a reconnect socket discarded by unmount or sign-out refreshes nothing and starts no timer', () => {
    for (const end of ['unmount', 'sign-out'] as const) {
      const qc = new QueryClient();
      const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
      const { sockets, makeSocket } = socketFactory();
      const { rerender, unmount } = renderHook(({ token }) => useWebSocket({ token, makeSocket }), {
        wrapper: wrapper(qc), initialProps: { token: 'jwt' as string | null },
      });
      sockets[0]!.emit('open', {}); // this run has opened once, so its next open is a "reopen"
      sockets[0]!.emit('close', {});
      vi.advanceTimersByTime(2000); // reconnecting: sockets[1] is connecting
      if (end === 'unmount') unmount(); else rerender({ token: null });
      expect(sockets[1]!.closed).toBe(true);
      sockets[1]!.emit('open', {}); // the discarded socket opens anyway
      expect(spy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      if (end === 'sign-out') unmount();
    }
  });

  it('the first open with a new token (sign-out, sign-in) is a first open', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { sockets, makeSocket } = socketFactory();
    const { rerender } = renderHook(({ token }) => useWebSocket({ token, makeSocket }), {
      wrapper: wrapper(qc), initialProps: { token: 'jwt-a' as string | null },
    });
    sockets[0]!.emit('open', {});
    rerender({ token: null });
    rerender({ token: 'jwt-b' });
    sockets[1]!.emit('open', {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('a reopen during a pending planner write defers the schedule refetch to the write\'s settle', async () => {
    vi.useRealTimers(); // the query/mutation half needs real timers for waitFor
    let release!: () => void;
    const api = {
      getSchedule: vi.fn(async () => []),
      listTasks: vi.fn(async () => []),
      updateScheduledBlock: vi.fn(() => new Promise<unknown>((r) => { release = () => r({}); })),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><ApiProvider client={fakeApiClient(api as never)}>{children}</ApiProvider></QueryClientProvider>
    );
    const { sockets, makeSocket } = socketFactory();
    const hook = renderHook(() => {
      useWebSocket({ token: 'jwt', makeSocket });
      return { schedule: useScheduleQuery('a', 'b'), tasks: useTasksQuery(), move: useUpdateScheduledBlockMutation() };
    }, { wrapper: Wrapper });
    await waitFor(() => expect(hook.result.current.schedule.isSuccess && hook.result.current.tasks.isSuccess).toBe(true));
    sockets[0]!.emit('open', {});
    api.getSchedule.mockClear();
    api.listTasks.mockClear();

    act(() => hook.result.current.move.mutate({ id: 'b1', patch: {} }));
    await waitFor(() => expect(api.updateScheduledBlock).toHaveBeenCalled());

    // The drop and the reconnect, on fake timers only for the 2s back-off.
    vi.useFakeTimers();
    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    act(() => sockets[1]!.emit('open', {}));

    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(1)); // unprotected root: now
    expect(api.getSchedule).not.toHaveBeenCalled(); // protected root: deferred

    await act(async () => { release(); });
    await waitFor(() => expect(api.getSchedule).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.getSchedule).toHaveBeenCalledTimes(1);
  });
});
