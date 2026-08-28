/**
 * Class string for the Priorities board's horizontally scrolling pane.
 *
 * Snapping and dnd-kit's edge auto-scroll cannot both own the scroll offset. With
 * `snap-mandatory` on, every auto-scroll tick the drag applies is immediately re-snapped by the
 * compositor to the nearest column start, so the pane teleports a whole column at a time instead
 * of creeping: measured on a 390px phone, a drag held at the pane's right edge produced **2**
 * scroll events in 4s with snap on, versus ~80 (per-frame deltas) with snap off. Between the
 * jumps the pointer is nowhere near the column it just skipped, so the neighbouring column is
 * effectively undroppable.
 *
 * So snapping is dropped for the duration of a drag and restored on drop/cancel — the pane
 * re-settles onto the nearest column, which reads as a gentle correction rather than a jump.
 * `scroll-pl-[30px]` keeps the pane's own left padding as the snap gutter, so the first column
 * lands with its inset intact instead of flush against the viewport edge.
 *
 * Desktop (`md+`) is unchanged: it never snapped (`md:snap-none`) and keeps native overscroll
 * chaining (`md:overscroll-auto`); the containment is a phone rubber-band fix.
 */
export function boardPaneClass(dragging: boolean): string {
  const base = 'min-h-0 flex-1 overflow-auto overscroll-contain scroll-pl-[30px] px-[30px] pb-10 md:overscroll-auto';
  return dragging ? `${base} snap-none` : `${base} snap-x snap-mandatory md:snap-none`;
}
