import type { ReactElement, ReactNode } from 'react';

export interface SheetProps {
  /** Accessible name; also used for the close button's label. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Literal Tailwind height class for the sheet body (JIT-visible at every call site). */
  heightClass?: string;
  /**
   * Slide the sheet down to a strip and make the backdrop inert, for the duration of a drag that
   * started inside it. The children stay mounted on purpose: unmounting the dragged card would
   * remove dnd-kit's active draggable node and abort the gesture.
   */
  collapsed?: boolean;
}

/**
 * Bottom sheet for phones: full-width, anchored to the bottom edge, drag-handle header, backdrop
 * tap dismisses. Sits on the app's modal tier (`z-50`, same as NewTaskModal) — MobileTabBar is a
 * z-40 bar pinned to the same bottom edge and rendered later in AppShell, so anything below z-50
 * would let taps in the bottom strip fall through to the tabs and navigate away.
 * Only rendered on the compact layout — desktop surfaces keep their inline panels.
 * Drawers (Task/Event/Habit) are NOT sheets yet; that is Phase 4.
 */
export function Sheet({ label, onClose, children, heightClass = 'h-[70dvh]', collapsed = false }: SheetProps): ReactElement {
  return (
    <div
      data-testid="sheet-backdrop"
      onClick={collapsed ? undefined : onClose}
      className={collapsed ? 'pointer-events-none fixed inset-0 z-50' : 'fixed inset-0 z-50 bg-black/30'}
    >
      <div
        data-testid="sheet"
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 flex ${heightClass} flex-col rounded-t-[18px] border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-pop transition-transform duration-200 ${collapsed ? 'translate-y-[calc(100%_-_56px)]' : 'translate-y-0'}`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2">
          <span className="w-10" />
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
          <button
            type="button"
            data-testid="sheet-close"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="w-10 rounded-[9px] p-2 text-inkSoft"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">{children}</div>
      </div>
    </div>
  );
}
