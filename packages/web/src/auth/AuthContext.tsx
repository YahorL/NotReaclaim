import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { tokenStore, type StoredAuth } from './tokenStore';

interface AuthValue {
  token: string | null;
  userId: string | null;
  setAuth: (auth: StoredAuth) => void;
  signOut: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<StoredAuth | null>(() => tokenStore.get());

  const setAuth = useCallback((next: StoredAuth) => {
    tokenStore.set(next);
    setAuthState(next);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setAuthState(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token: auth?.token ?? null, userId: auth?.userId ?? null, setAuth, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
