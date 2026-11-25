import { useLayoutEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../../theme/usePrefersReducedMotion';

/** Prototype list re-flow: `--dur-reflow` 240ms on `--ease-out`, as literals (WAAPI takes no var()). */
export const FLIP_DURATION_MS = 240;
export const FLIP_EASING = 'cubic-bezier(.2,.8,.2,1)';

/**
 * FLIP: when the keyed order changes, animate each registered element from its previous position
 * to its new one, so cards slide aside instead of jumping.
 *
 * Positions are `offsetTop`s, relative to the elements' offset parent (the column's list, which is
 * `relative`). Unlike viewport rects they ignore transforms (dnd-kit's sorting offsets, a running
 * FLIP) and scrolling of the board pane between two order changes — a viewport `top` recorded
 * before the user scrolled made every card glide by the scroll distance on the next re-sort.
 *
 * `skip` records the new positions without animating: Board passes it for the render that commits
 * a same-column pointer drop, whose cards dnd-kit had already slid into their new places. Reduced
 * motion skips always. No-op where the Web Animations API is unavailable (jsdom).
 */
export function useFlip(orderKey: string, skip = false): (key: string) => (el: HTMLElement | null) => void {
  const reducedMotion = usePrefersReducedMotion();
  const refs = useRef(new Map<string, HTMLElement | null>());
  const prevTops = useRef(new Map<string, number>());
  const prevKey = useRef(orderKey);

  // Measures after every commit (so a card that grew — a subtask added — or a column that was
  // re-expanded never leaves a stale position behind), animates only when the order changed.
  useLayoutEffect(() => {
    const reordered = prevKey.current !== orderKey;
    prevKey.current = orderKey;
    const nextTops = new Map<string, number>();
    for (const [key, el] of refs.current) {
      if (!el || !el.isConnected) continue;
      const top = el.offsetTop;
      nextTops.set(key, top);
      const before = prevTops.current.get(key);
      if (reordered && !skip && !reducedMotion && before !== undefined && before !== top && typeof el.animate === 'function') {
        el.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
          { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
        );
      }
    }
    prevTops.current = nextTops;
  });

  return (key: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}
