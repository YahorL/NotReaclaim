import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../test/matchMedia';
import { useTheme, resetThemeStoreForTests } from './useTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { DARK_QUERY, THEME_KEY } from './theme';

let mm: FakeMatchMedia | null = null;
const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  resetThemeStoreForTests();
  root.removeAttribute('data-theme');
});
afterEach(() => { mm?.restore(); mm = null; localStorage.clear(); });

describe('useTheme', () => {
  it('defaults to system and resolves from prefers-color-scheme', () => {
    mm = installMatchMedia({ [DARK_QUERY]: false });
    const { result } = renderHook(() => useTheme());
    expect(result.current.pref).toBe('system');
    expect(result.current.theme).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to dark without matchMedia (jsdom default)', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('follows media changes while the pref is system', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    act(() => { mm!.set(DARK_QUERY, false); });
    expect(result.current.theme).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('reads a stored explicit pref and ignores media changes (and stops listening)', () => {
    localStorage.setItem(THEME_KEY, 'light');
    mm = installMatchMedia({ [DARK_QUERY]: true });
    const { result } = renderHook(() => useTheme());
    expect(result.current.pref).toBe('light');
    expect(result.current.theme).toBe('light');
    expect(mm.listenerCount(DARK_QUERY)).toBe(0);
    act(() => { mm!.set(DARK_QUERY, false); mm!.set(DARK_QUERY, true); });
    expect(result.current.theme).toBe('light');
  });

  it('setPref persists, applies data-theme on <html> and returns to system', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setPref('light'); });
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(result.current).toMatchObject({ pref: 'light', theme: 'light' });
    expect(mm.listenerCount(DARK_QUERY)).toBe(0);

    act(() => { result.current.setPref('system'); });
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(result.current).toMatchObject({ pref: 'system', theme: 'dark' });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(mm.listenerCount(DARK_QUERY)).toBe(1);
  });

  it('shares one pref between every mounted instance (rail switch + Settings Appearance)', () => {
    const a = renderHook(() => useTheme());
    const b = renderHook(() => useTheme());
    act(() => { a.result.current.setPref('light'); });
    expect(b.result.current).toMatchObject({ pref: 'light', theme: 'light' });
  });

  it('keeps working in-session when storage throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      const { result } = renderHook(() => useTheme());
      expect(result.current.pref).toBe('system');
      act(() => { result.current.setPref('light'); });
      expect(result.current.theme).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('removes its media listener on unmount', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    const { unmount } = renderHook(() => useTheme());
    expect(mm.listenerCount(DARK_QUERY)).toBe(1);
    unmount();
    expect(mm.listenerCount(DARK_QUERY)).toBe(0);
  });
});

describe('usePrefersReducedMotion', () => {
  const QUERY = '(prefers-reduced-motion: reduce)';

  it('is false without matchMedia', () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('follows the media query', () => {
    mm = installMatchMedia({ [QUERY]: true });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    act(() => { mm!.set(QUERY, false); });
    expect(result.current).toBe(false);
  });
});
