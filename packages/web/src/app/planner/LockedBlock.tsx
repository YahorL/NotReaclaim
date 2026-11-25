import type { ComponentProps } from 'react';
import { CalendarBlock } from './CalendarBlock';
import { useShake } from './useShake';
import { useToast } from '../shell/ToastProvider';

export const LOCKED_TOAST = 'Locked — synced from Google Calendar';
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * A Google-synced tile (spec D5 hybrid locking): it mirrors the remote calendar, so a press or an
 * arrow key that tries to move it shakes it (450ms) and toasts why — no capture, no drag. A click
 * still selects it (the detail card says where to edit it).
 */
export function LockedBlock(props: ComponentProps<typeof CalendarBlock>) {
  const { shaking, shake } = useShake();
  const toast = useToast();
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
        // Not on the hover ×: it stops propagation itself; a press on the body is a move attempt.
        refuse();
      }}
      onBodyKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || !ARROWS.has(e.key)) return;
        e.preventDefault();
        refuse();
      }}
    />
  );
}
