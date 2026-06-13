import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointerdown lands outside `ref`. Used to dismiss drawers/popovers
 * by clicking the surrounding page. The click that *opened* the element fired before this
 * effect subscribed, so it won't self-close on mount.
 */
export function useClickOutside<T extends HTMLElement>(ref: RefObject<T>, onOutside: () => void): void {
  useEffect(() => {
    function handle(e: MouseEvent) {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, onOutside]);
}
