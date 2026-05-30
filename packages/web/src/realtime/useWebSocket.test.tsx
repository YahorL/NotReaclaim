import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWebSocket, type SocketLike } from './useWebSocket';

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
