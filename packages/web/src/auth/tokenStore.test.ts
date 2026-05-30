import { describe, it, expect, beforeEach } from 'vitest';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

describe('tokenStore', () => {
  it('returns null when empty and round-trips a stored value', () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
  });

  it('clears the stored value', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('returns null for a corrupt value', () => {
    localStorage.setItem('notreclaim.auth', '{not json');
    expect(tokenStore.get()).toBeNull();
  });
});
