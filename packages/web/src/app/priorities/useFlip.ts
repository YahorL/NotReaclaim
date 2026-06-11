import { useLayoutEffect, useRef } from 'react';

/**
 * FLIP: when the keyed order changes, animate each registered element from its
 * previous viewport position to its new one (smooth row shuffling on reorder).
 * No-op where the Web Animations API is unavailable (jsdom).
 */
export function useFlip(orderKey: string): (key: string) => (el: HTMLElement | null) => void {
  const refs = useRef(new Map<string, HTMLElement | null>());
  const prevTops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    for (const [key, el] of refs.current) {
      if (!el || !el.isConnected) continue;
      const top = el.getBoundingClientRect().top;
      nextTops.set(key, top);
      const before = prevTops.current.get(key);
      if (before !== undefined && before !== top && typeof el.animate === 'function') {
        el.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'ease-out' },
        );
      }
    }
    prevTops.current = nextTops;
  }, [orderKey]);

  return (key: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}
