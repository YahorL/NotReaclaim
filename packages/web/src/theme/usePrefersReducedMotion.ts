import { useMediaQuery } from '../app/lib/useMediaQuery';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Gate for JS-driven motion (WAAPI FLIP, staggers, shake). CSS motion is already covered by
 * the global kill switch in index.css. False when matchMedia is missing (jsdom).
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
