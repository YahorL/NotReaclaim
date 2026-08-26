import { useEffect, useState } from 'react';

/** Touch/pen input. Drives affordances (long-press arming, tap targets), never layout. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** "Below Tailwind `md`" — 767.98px so it can never overlap `md` (768px) on fractional zoom. */
export const COMPACT_WIDTH_QUERY = '(max-width: 767.98px)';

function currentMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * Reactive media query. jsdom implements no `matchMedia`, so under test this is always `false`
 * and every component keeps its desktop / fine-pointer branch unless a test installs a fake.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => currentMatch(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches); // the query may have flipped between render and effect
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 / older jsdom shims only have the deprecated pair.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
}

/** True on touch/pen devices, regardless of viewport width (a landscape tablet is both). */
export function usePointerCoarse(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

/** True below Tailwind's `md` breakpoint — the mobile chrome / mobile planner geometry. */
export function useCompactWidth(): boolean {
  return useMediaQuery(COMPACT_WIDTH_QUERY);
}
