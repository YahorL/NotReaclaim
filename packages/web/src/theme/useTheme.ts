import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DARK_QUERY, applyTheme, readPref, resolveTheme, systemPrefersDark, writePref,
  type Theme, type ThemePref,
} from './theme';

// The pref is module-level shared state, not per-hook state: the rail's ThemeSwitch and the
// Settings "Appearance" control are mounted together and must never disagree. It is held in
// memory (seeded from localStorage once) so switching still works for the session when
// storage is blocked.

let current: ThemePref | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getPref(): ThemePref {
  if (current === null) current = readPref(storage());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setPref(next: ThemePref): void {
  current = next;
  writePref(storage(), next);
  applyTheme(document, resolveTheme(next, systemPrefersDark()));
  for (const l of [...listeners]) l();
}

/** Test-only: forget the in-memory pref so the next read re-seeds from localStorage. */
export function resetThemeStoreForTests(): void {
  current = null;
}

export interface ThemeState {
  pref: ThemePref;
  theme: Theme;
  setPref: (pref: ThemePref) => void;
}

export function useTheme(): ThemeState {
  const pref = useSyncExternalStore(subscribe, getPref, getPref);
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark());

  // Follow the OS only while the pref is 'system' (same missing-matchMedia guard as
  // useMediaQuery, plus the deprecated addListener pair for Safari < 14).
  useEffect(() => {
    if (pref !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    setPrefersDark(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [pref]);

  const theme = resolveTheme(pref, prefersDark);
  useEffect(() => { applyTheme(document, theme); }, [theme]);

  return { pref, theme, setPref };
}

/**
 * App-root subscription: applies the resolved theme and follows OS changes while the pref is
 * 'system', on every route — the rail's ThemeSwitch is not mounted when the sidebar is hidden or
 * on the auth pages, so it cannot be the only subscriber.
 */
export function useThemeSync(): void {
  useTheme();
}
