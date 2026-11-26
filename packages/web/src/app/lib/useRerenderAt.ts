import { useEffect, useReducer } from 'react';

/** Longer waits are cut into steps: setTimeout overflows past ~24.8 days, and an hour is cheap. */
const MAX_WAIT_MS = 60 * 60 * 1000;

/**
 * Re-render the calling component just after `atMs` (measured from the `nowMs` it rendered with),
 * so state that depends on the clock — a block that has started or ended — catches up without a
 * ticking interval. The component reads the clock again on that render (it takes `now` as an
 * input, so tests with a fixed clock stay deterministic). Nothing happens for null.
 */
export function useRerenderAt(atMs: number | null, nowMs: number): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (atMs === null) return;
    const t = setTimeout(rerender, Math.min(MAX_WAIT_MS, Math.max(0, atMs - nowMs) + 1));
    return () => clearTimeout(t);
  }, [atMs, nowMs]);
}
