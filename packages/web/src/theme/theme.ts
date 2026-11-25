// Theme runtime — pure, DOM/storage passed in. Source of truth for the pre-paint <script> in
// index.html, which duplicates readPref + resolveTheme (keep the two in step; theme.test.ts
// runs the script against the same decision table).

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

/** localStorage key. Absent = 'system' (follow the OS). */
export const THEME_KEY = 'nr.theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const SWITCHING_CLASS = 'theme-switching';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function readPref(storage: ReadStorage | null | undefined): ThemePref {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Persists an explicit pref; 'system' removes the key. False when storage is unavailable. */
export function writePref(storage: WriteStorage | null | undefined, pref: ThemePref): boolean {
  if (!storage) return false;
  try {
    if (pref === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): Theme {
  if (pref !== 'system') return pref;
  return prefersDark ? 'dark' : 'light';
}

/** OS preference. Dark (the token default) when matchMedia is missing or throws. */
export function systemPrefersDark(win: { matchMedia?: unknown } | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  try {
    const mm = win?.matchMedia;
    if (typeof mm !== 'function') return true;
    return (mm.call(win, DARK_QUERY) as MediaQueryList).matches;
  } catch {
    return true;
  }
}

function defaultNextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb());
  else setTimeout(cb, 0);
}

/**
 * Sets `data-theme` + `color-scheme` on <html>. On an actual change, `theme-switching` (which
 * kills transitions, see index.css) is held across a forced style flush and dropped next
 * frame — so colours swap instantly instead of every block animating its background.
 */
export function applyTheme(doc: Document, theme: Theme, nextFrame: (cb: () => void) => void = defaultNextFrame): void {
  const root = doc.documentElement;
  root.style.colorScheme = theme;
  if (root.getAttribute('data-theme') === theme) return;
  root.classList.add(SWITCHING_CLASS);
  root.setAttribute('data-theme', theme);
  void doc.defaultView?.getComputedStyle(root).color; // flush styles while transitions are off
  nextFrame(() => root.classList.remove(SWITCHING_CLASS));
}
