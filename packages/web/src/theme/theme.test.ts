import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THEME_KEY, DARK_QUERY, readPref, writePref, resolveTheme, systemPrefersDark, applyTheme,
  type ThemePref,
} from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    map,
  };
}

const throwing = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

const winWith = (dark: boolean | 'missing' | 'throws') => ({
  matchMedia: dark === 'missing' ? undefined
    : dark === 'throws' ? () => { throw new Error('nope'); }
      : (q: string) => ({ matches: q === DARK_QUERY ? dark : false }),
});

describe('readPref / writePref', () => {
  it('round-trips explicit prefs under nr.theme', () => {
    const s = memoryStorage();
    writePref(s, 'light');
    expect(s.map.get(THEME_KEY)).toBe('light');
    expect(readPref(s)).toBe('light');
    writePref(s, 'dark');
    expect(readPref(s)).toBe('dark');
  });

  it("'system' removes the key", () => {
    const s = memoryStorage({ [THEME_KEY]: 'dark' });
    writePref(s, 'system');
    expect(s.map.has(THEME_KEY)).toBe(false);
    expect(readPref(s)).toBe('system');
  });

  it('treats a missing or unknown value as system', () => {
    expect(readPref(memoryStorage())).toBe('system');
    expect(readPref(memoryStorage({ [THEME_KEY]: 'sepia' }))).toBe('system');
    expect(readPref(null)).toBe('system');
  });

  it('survives a throwing storage (private mode, blocked site data)', () => {
    expect(readPref(throwing)).toBe('system');
    expect(writePref(throwing, 'light')).toBe(false);
    expect(writePref(throwing, 'system')).toBe(false);
    expect(writePref(memoryStorage(), 'light')).toBe(true);
  });
});

describe('resolveTheme', () => {
  it.each<[ThemePref, boolean, 'light' | 'dark']>([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ])('%s with prefersDark=%s → %s', (pref, prefersDark, expected) => {
    expect(resolveTheme(pref, prefersDark)).toBe(expected);
  });
});

describe('systemPrefersDark', () => {
  it('follows the media query both ways', () => {
    expect(systemPrefersDark(winWith(true))).toBe(true);
    expect(systemPrefersDark(winWith(false))).toBe(false);
  });

  it('falls back to dark (the token default) without a usable matchMedia', () => {
    expect(systemPrefersDark(winWith('missing'))).toBe(true);
    expect(systemPrefersDark(winWith('throws'))).toBe(true);
  });
});

describe('applyTheme', () => {
  const root = document.documentElement;
  beforeEach(() => {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
    root.classList.remove('theme-switching');
  });

  it('sets data-theme and color-scheme on <html>', () => {
    applyTheme(document, 'light', () => {});
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    applyTheme(document, 'dark', () => {});
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('suppresses transitions for one frame while the theme changes', () => {
    root.setAttribute('data-theme', 'dark');
    const frames: Array<() => void> = [];
    applyTheme(document, 'light', (cb) => { frames.push(cb); });
    expect(root.classList.contains('theme-switching')).toBe(true);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('is a no-op (no switching class) when the theme is already applied', () => {
    root.setAttribute('data-theme', 'dark');
    const nextFrame = vi.fn();
    applyTheme(document, 'dark', nextFrame);
    expect(nextFrame).not.toHaveBeenCalled();
    expect(root.classList.contains('theme-switching')).toBe(false);
    expect(root.style.colorScheme).toBe('dark');
  });
});

// The inline <script> in index.html duplicates readPref + resolveTheme so the theme is set
// before first paint. Run its actual text against the same decision table.
describe('index.html pre-paint script', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const match = head.match(/<script>([\s\S]*?)<\/script>/);
  const source = match?.[1] ?? '';

  function runScript(storage: unknown, win: { matchMedia?: unknown }) {
    const root = document.documentElement;
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
    const fakeWindow = { ...win, get localStorage() { if (storage === 'throws') throw new Error('denied'); return storage; } };
    new Function('window', 'document', source)(fakeWindow, document);
    return { theme: root.getAttribute('data-theme'), scheme: root.style.colorScheme };
  }

  it('is an inline classic script in <head>, before any stylesheet', () => {
    expect(source.length).toBeGreaterThan(0);
    expect(head.indexOf('<script>')).toBeLessThan(head.indexOf('stylesheet'));
    expect(source.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(15);
  });

  const stored: Array<string | null> = ['light', 'dark', 'sepia', null];
  const media: Array<boolean | 'missing' | 'throws'> = [true, false, 'missing', 'throws'];
  for (const value of stored) {
    for (const dark of media) {
      it(`stored=${value} prefersDark=${dark} matches resolveTheme`, () => {
        const storage = memoryStorage(value === null ? {} : { [THEME_KEY]: value });
        const expected = resolveTheme(readPref(storage), systemPrefersDark(winWith(dark)));
        expect(runScript(storage, winWith(dark))).toEqual({ theme: expected, scheme: expected });
      });
    }
  }

  it('falls back to the system theme when storage throws', () => {
    expect(runScript('throws', winWith(false)).theme).toBe('light');
    expect(runScript('throws', winWith(true)).theme).toBe('dark');
  });

  it('defaults to dark when everything fails', () => {
    expect(runScript('throws', winWith('throws')).theme).toBe('dark');
  });
});
