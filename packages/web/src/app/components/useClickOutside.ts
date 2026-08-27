import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointerdown lands outside `ref`. Used to dismiss drawers/popovers
 * by clicking the surrounding page. The click that *opened* the element fired before this
 * effect subscribed, so it won't self-close on mount.
 *
 * `enabled: false` unsubscribes entirely, for surfaces hosted inside a modal Sheet: the sheet
 * already owns dismissal, and a second outside-dismiss here would close on the press and hand the
 * following click to whatever sits under the backdrop.
 */
export function useClickOutside<T extends HTMLElement>(ref: RefObject<T>, onOutside: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handle(e: MouseEvent) {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, onOutside, enabled]);
}
