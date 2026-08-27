import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * The pointer's live viewport Y while `active`, in a ref so reading it never re-renders.
 *
 * dnd-kit does not report live pointer coordinates: `activatorEvent + delta` is the drag-START
 * frame of reference, and `delta` carries a scroll adjustment whose scrollable-ancestor set swaps
 * from the ACTIVE node's to the OVER node's the moment a droppable is entered — while the offset
 * baseline behind it (`useScrollOffsetsDelta`, deps `[]`) does not reset. Reconstructing the
 * pointer from that pair therefore jumps by whatever the newly-tracked container is scrolled to
 * (for the planner: the hours-scroll's scroll-to-now, ~600px, pinning every drop near midnight
 * when the task list itself was scrolled). A window listener has no such frame of reference
 * problem: it is simply where the pointer is.
 *
 * `pointermove` alone covers mouse, pen and touch on every browser this app targets, so no
 * separate `touchmove` listener is armed.
 */
export function useLivePointerY(active: boolean): MutableRefObject<number | null> {
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      ref.current = null;
      return;
    }
    const onMove = (e: Event) => { ref.current = (e as MouseEvent).clientY; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      // Never let one drag's last position seed the next drag's first frame.
      ref.current = null;
    };
  }, [active]);
  return ref;
}
