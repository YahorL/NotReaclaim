import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWebSocket, type SocketLike } from './useWebSocket';

const fakeSocket = (): SocketLike => ({ addEventListener: () => {}, close: () => {} });

function connectUrl(): string {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const makeSocket = vi.fn((_url: string) => fakeSocket());
  renderHook(() => useWebSocket({ token: 'a b', makeSocket }), { wrapper });
  expect(makeSocket).toHaveBeenCalledTimes(1);
  return makeSocket.mock.calls[0]![0];
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('useWebSocket URL', () => {
  it('without VITE_API_URL connects to the page host, as before', () => {
    vi.stubEnv('VITE_API_URL', '');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(connectUrl()).toBe(`${proto}//${window.location.host}/ws?token=a%20b`);
  });

  it('with VITE_API_URL set connects to the API host, keeping the token query', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
    expect(connectUrl()).toBe('wss://api.example.com/ws?token=a%20b');
  });
});
