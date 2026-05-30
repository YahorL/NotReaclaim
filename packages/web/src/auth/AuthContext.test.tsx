import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('token').textContent).toBe('none');

    fireEvent.click(screen.getByText('in'));
    expect(screen.getByTestId('token').textContent).toBe('jwt');
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });

    fireEvent.click(screen.getByText('out'));
    expect(screen.getByTestId('token').textContent).toBe('none');
    expect(tokenStore.get()).toBeNull();
  });
});
