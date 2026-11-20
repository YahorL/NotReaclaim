import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

function Probe() {
  const { token, setAuth, signOut } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => setAuth({ token: 'jwt', userId: 'u1' })}>in</button>
      <button onClick={signOut}>out</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('hydrates from tokenStore, persists setAuth, and clears on signOut', () => {
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
    expect(screen.getByTestId('token').textContent).toBe('none');

    fireEvent.click(screen.getByText('in'));
    expect(screen.getByTestId('token').textContent).toBe('jwt');
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });

    fireEvent.click(screen.getByText('out'));
    expect(screen.getByTestId('token').textContent).toBe('none');
    expect(tokenStore.get()).toBeNull();
  });
});

describe('AuthContext and the query cache', () => {
  // Mirrors the app: data components sit behind a token gate (ProtectedRoute) and are stable
  // child elements, so an auth change does not by itself re-render them.
  function Gate({ children }: { children: ReactNode }) {
    const { token, setAuth, signOut } = useAuth();
    return (
      <div>
        <button onClick={() => setAuth({ token: 'jwt-b', userId: 'uB' })}>as B</button>
        <button onClick={signOut}>out</button>
        {token && children}
      </div>
    );
  }
  function Tasks({ fetchTasks }: { fetchTasks: () => Promise<string> }) {
    const q = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks });
    return <span data-testid="tasks">{q.data ?? 'loading'}</span>;
  }
  function renderAs(fetchTasks: () => Promise<string>) {
    tokenStore.set({ token: 'jwt-a', userId: 'uA' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['tasks'], 'A-tasks');
    qc.setQueryData(['settings'], 'A-settings'); // not observed by anything
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider><Gate><Tasks fetchTasks={fetchTasks} /></Gate></AuthProvider>
      </QueryClientProvider>,
    );
    return qc;
  }

  it('signOut empties the cache', async () => {
    const qc = renderAs(async () => 'A-tasks');
    expect(screen.getByTestId('tasks')).toHaveTextContent('A-tasks');
    fireEvent.click(screen.getByText('out'));
    expect(screen.queryByTestId('tasks')).toBeNull();
    expect(qc.getQueryData(['tasks'])).toBeUndefined();
    expect(qc.getQueryData(['settings'])).toBeUndefined();
  });

  it('signOut refetches nothing afterwards — no request goes out without a token', async () => {
    const tokensSeen: (string | null)[] = [];
    const fetchTasks = vi.fn(async () => { tokensSeen.push(tokenStore.get()?.token ?? null); return 'A-tasks'; });
    const qc = renderAs(fetchTasks);
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(1)); // mount refetch as A
    fireEvent.click(screen.getByText('out'));
    // The usual refetch triggers after a sign-out: a late realtime invalidation and a window refocus.
    await act(async () => {
      await qc.invalidateQueries();
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchTasks).toHaveBeenCalledTimes(1);
    expect(tokensSeen).toEqual(['jwt-a']);
  });

  it('signing in as someone else without a reload drops the previous user’s data and refetches', async () => {
    let resolveB!: (v: string) => void;
    const fetchTasks = vi.fn(() => (tokenStore.get()?.token === 'jwt-b'
      ? new Promise<string>((r) => { resolveB = r; })
      : Promise.resolve('A-tasks')));
    const qc = renderAs(fetchTasks);
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(1)); // mount refetch as A
    expect(screen.getByTestId('tasks')).toHaveTextContent('A-tasks');

    fireEvent.click(screen.getByText('as B'));
    // B's fetch is still pending: A's tasks must not be on screen or in the cache meanwhile.
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('tasks')).toHaveTextContent('loading');
    expect(qc.getQueryData(['tasks'])).toBeUndefined();
    expect(qc.getQueryData(['settings'])).toBeUndefined();

    act(() => resolveB('B-tasks'));
    await waitFor(() => expect(screen.getByTestId('tasks')).toHaveTextContent('B-tasks'));
  });

  it('re-setting the same session keeps the cache', () => {
    const qc = renderAs(async () => 'A-tasks');
    tokenStore.set({ token: 'jwt-b', userId: 'uB' }); // so "as B" is the current session
    fireEvent.click(screen.getByText('as B'));
    expect(qc.getQueryData(['settings'])).toBe('A-settings');
  });
});
