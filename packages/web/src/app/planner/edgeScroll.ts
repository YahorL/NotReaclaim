import { useEffect, useRef } from 'react';

/** How deep into the container an edge drag starts scrolling. */
export const EDGE_ZONE_PX = 48;
/** Pixels per frame at the very edge (≈ 840px/s at 60fps). */
export const MAX_EDGE_SCROLL_PX = 14;

/**
 * Signed pixels to scroll this frame: negative near the top, positive near the bottom, zero in
 * the middle, linearly ramped and clamped past the edge. Pure — the caller owns the rAF loop.
 */
export function edgeScrollStep(
  clientY: number,
  top: number,
  bottom: number,
  zonePx = EDGE_ZONE_PX,
  maxPx = MAX_EDGE_SCROLL_PX,
): number {
  const height = bottom - top;
  if (height <= 0) return 0;                 // jsdom / unlaid-out container: never scroll
  const zone = Math.min(zonePx, height / 2); // the two zones must not overlap
  if (zone <= 0) return 0;
  if (clientY < top + zone) {
    const depth = Math.min(zone, top + zone - clientY);
    return -Math.ceil((depth / zone) * maxPx);
  }
  if (clientY > bottom - zone) {
    const depth = Math.min(zone, clientY - (bottom - zone));
    return Math.ceil((depth / zone) * maxPx);
  }
  return 0;
}

/**
 * rAF loop that scrolls a DI'd container while a drag hovers near its edges. The container is
 * supplied as a getter so the caller can pass a ref that is null on the first render, and so
 * tests can hand in a plain object.
 *
 * `onScrolled` fires after every frame that actually moved the container, with the last known
 * pointer y. It is what keeps a *stationary* finger honest: no pointermove arrives while the
 * finger rests in the edge zone, so without this callback the drag preview would freeze while
 * the content slid out from under it (and pointer-up would then commit a delta the held preview
 * never showed — the R10/R11 landing-jump class of bug).
 */
export function useEdgeAutoScroll(
  getContainer: () => HTMLElement | null,
  onScrolled?: (clientY: number) => void,
): {
  update(clientY: number): void;
  stop(): void;
} {
  const getRef = useRef(getContainer);
  const cbRef = useRef(onScrolled);
  const yRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { getRef.current = getContainer; cbRef.current = onScrolled; });
  useEffect(() => () => {
    if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
  }, []);

  const api = useRef({
    update(clientY: number) {
      yRef.current = clientY;
      if (rafRef.current != null || typeof requestAnimationFrame !== 'function') return;
      const tick = () => {
        rafRef.current = null;
        const y = yRef.current;
        const el = getRef.current();
        if (y == null || !el) return;
        const rect = el.getBoundingClientRect();
        const step = edgeScrollStep(y, rect.top, rect.bottom);
        // Outside the edge zone: stop spinning at 60fps for the rest of the drag. rafRef is
        // already null, so the next update() (i.e. the next pointermove) restarts the loop.
        if (step === 0) return;
        el.scrollTop += step;
        cbRef.current?.(y);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    stop() {
      yRef.current = null;
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
  });

  return api.current;
}
