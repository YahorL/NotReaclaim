import { useEffect, useRef, type ComponentProps } from 'react';
import { CalendarBlock } from './CalendarBlock';
import { useShake } from './useShake';
import { useToast } from '../shell/ToastProvider';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './longPress';

export const LOCKED_TOAST = 'Locked — synced from Google Calendar';
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * A Google-synced tile (spec D5 hybrid locking): it mirrors the remote calendar, so a press or an
 * arrow key that tries to move it shakes it (450ms) and toasts why — no capture, no drag. A click
 * still selects it (the detail card says where to edit it).
 *
 * Touch: a finger landing on the tile is usually the start of a scroll through the hours, so the
 * refusal waits for the same long press that arms a movable tile's drag, and a finger that
 * travels (scrolls) or lifts first never shakes.
 */
export function LockedBlock(props: ComponentProps<typeof CalendarBlock>) {
  const { shaking, shake } = useShake();
  const toast = useToast();
  const touchRef = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelTouch = () => {
    if (touchRef.current) clearTimeout(touchRef.current.timer);
    touchRef.current = null;
  };
  useEffect(() => cancelTouch, []);
  const refuse = () => {
    shake();
    toast.show(LOCKED_TOAST, { icon: 'lock' });
  };
  return (
    <CalendarBlock
      {...props}
      shake={shaking}
      onPointerDown={(e) => {
        if (e.button != null && e.button > 0) return;
        // The hover × stops propagation itself; a press on the body is a move attempt.
        if (e.pointerType === 'touch') {
          cancelTouch();
          touchRef.current = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { touchRef.current = null; refuse(); }, LONG_PRESS_MS) };
          return;
        }
        refuse();
      }}
      onPointerMove={(e) => {
        const t = touchRef.current;
        if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > LONG_PRESS_SLOP_PX) cancelTouch();
      }}
      onPointerUp={cancelTouch}
      onPointerCancel={cancelTouch}
      onBodyKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || !ARROWS.has(e.key)) return;
        e.preventDefault();
        refuse();
      }}
    />
  );
}
