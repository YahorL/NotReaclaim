import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tokenStore, type StoredAuth } from './tokenStore';

interface AuthValue {
  token: string | null;
  setAuth: (auth: StoredAuth) => void;
  signOut: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

/**
 * Owns the signed-in session. The query cache belongs to that session, so it is emptied here, in
 * the same call that ends or replaces the session (before the state update renders anything):
 * nothing cached for one identity may be shown to, or read by, the next.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [auth, setAuthState] = useState<StoredAuth | null>(() => tokenStore.get());

  const setAuth = useCallback((next: StoredAuth) => {
    const prev = tokenStore.get();
    tokenStore.set(next);
    if (prev && prev.token !== next.token) {
      // A new session replacing a live one. resetQueries (not clear) because the app's mounted
      // queries stay mounted across the swap: reset tells their observers, drops every query's
      // data, cancels the old session's in-flight fetches and refetches the active ones — with
      // the new token, which the API client reads from tokenStore (already set above).
      queryClient.getMutationCache().clear();
      void queryClient.resetQueries();
    }
    setAuthState(next);
  }, [queryClient]);

  const signOut = useCallback(() => {
    tokenStore.clear();
    // clear (not reset): resetting would refetch the still-mounted queries with no token. The
    // gated pages unmount on the render below, so their now-orphaned observers just go away.
    queryClient.clear();
    setAuthState(null);
  }, [queryClient]);

  return (
    <AuthCtx.Provider value={{ token: auth?.token ?? null, setAuth, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
