import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenStore } from './tokenStore';

beforeEach(() => {
  localStorage.clear();
  tokenStore.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('tokenStore', () => {
  it('returns null when empty and round-trips a stored value', () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
    expect(localStorage.getItem('notreclaim.auth')).not.toBeNull();
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

  it('keeps the session in memory when even reading window.localStorage throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set({ token: 'jwt', userId: 'u1' })).not.toThrow();
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
    expect(() => tokenStore.clear()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });

  it('reads back a session whose write alone failed (quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    tokenStore.set({ token: 'jwt', userId: 'u3' });
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u3' });
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('survives storage methods that throw (quota / disabled)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('nope'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('nope'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('nope'); });
    tokenStore.set({ token: 'jwt', userId: 'u2' });
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u2' });
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });
});
