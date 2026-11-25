import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react';

/**
 * Everything a browser will Tab to inside the sheet. `[tabindex="-1"]` is excluded on purpose:
 * the sheet container itself — and dnd-kit's task cards — are focusable programmatically but are
 * not tab stops, so they must never be the wrap target.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Everything the two variants share. Split out only so each variant stays one literal string. */
const FRAME =
  'pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-pop transition-transform duration-200';

export interface SheetProps {
  /** Accessible name; also used for the close button's label. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Full-viewport variant for drawers: `h-dvh` with square top corners. Default: the 70dvh sheet. */
  fullScreen?: boolean;
  /** Scroll the sheet body. Off by default — PlannerTaskPanel owns its own inner scroll region. */
  scrollBody?: boolean;
  /**
   * Slide the sheet down to a strip and make the backdrop inert, for the duration of a drag that
   * started inside it. The children stay mounted on purpose: unmounting the dragged card would
   * remove dnd-kit's active draggable node and abort the gesture.
   *
   * The `duration-200` transition on that slide is load-bearing, not decoration: collapsing
   * instantly would move the sheet within the drag's very first commit, and dnd-kit's
   * layout-shift scroll compensation would read that as the page scrolling under the pointer and
   * translate the dragged overlay by the same amount.
   */
  collapsed?: boolean;
}

export interface FocusTrapOptions {
  /** Called on Escape pressed inside the trapped element. */
  onEscape?: () => void;
  /**
   * Where focus goes back on unmount. Default: whatever was focused when the trap first rendered.
   * Pass the opener explicitly when the trapped surface is mounted conditionally inside an
   * always-mounted component (a menu under its button), where the render-time capture could be stale.
   */
  restoreTo?: RefObject<HTMLElement | null>;
  /** Element to focus on mount instead of the container (skipped when focus is already inside). */
  initialFocus?: () => HTMLElement | null;
}

/**
 * The focus contract every modal surface shares (Sheet, the search palette, the account menu, the
 * new-task dialog): take focus on mount, trap Tab while open, Escape via the surface's OWN keydown,
 * and return focus to the opener on unmount. Returns the `onKeyDown` handler to put on the element.
 */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T>, { onEscape, restoreTo, initialFocus }: FocusTrapOptions = {}) {
  // Captured during the RENDER phase, on purpose. React applies a child's `autoFocus` in the
  // commit phase, so reading `document.activeElement` from the mount effect below would record
  // that child instead of the element that opened the surface -- and a child is detached by the
  // time the cleanup runs, dropping focus to <body>. This lazy initializer runs before either.
  const [previousFocus] = useState<Element | null>(() => document.activeElement);
  // Read at mount only: later changes to these callbacks must not re-run the focus effect.
  const initialFocusRef = useRef(initialFocus);
  const restoreRef = useRef(restoreTo);

  // Initial focus + focus return, once per mount. The containment check keeps an `autoFocus`ed
  // field inside the surface: React applies autoFocus in the commit phase, before this passive
  // effect runs, so stealing it back would fight the form for the caret.
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) (initialFocusRef.current?.() ?? el).focus();
    const restore = restoreRef.current;
    return () => {
      const target = restore?.current ?? previousFocus;
      // Skip a node that has since left the document -- refocusing it would be a silent no-op that
      // strands focus on <body>, and there is nothing better to aim at.
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [ref, previousFocus]);

  // Escape and Tab are the surface's OWN keystrokes, deliberately not the document's. A document
  // listener fires on every mounted surface at once: AppShell renders NewTaskModal as a sibling, so
  // on compact a modal can sit over an open sheet and Escape would dismiss the sheet behind it --
  // and a drawer can be stacked in a sheet. The focus trap makes the topmost surface the one that
  // receives the key.
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { onEscape?.(); return; }
    if (e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) { e.preventDefault(); return; }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
}

/**
 * The app's one modal shell for phones: full-width, anchored to the bottom edge, drag-handle
 * header with a ✕, backdrop tap dismisses, Escape dismisses it while it holds focus, focus is
 * taken on mount, trapped while open and returned on unmount.
 *
 * Sits on the modal tier (`z-50`, same as NewTaskModal) — MobileTabBar is a z-40 bar pinned to the
 * same bottom edge and rendered later in AppShell, so anything below z-50 would let taps in the
 * bottom strip fall through to the tabs.
 *
 * It carries **no transform unless `collapsed`**: a standing transform would make the sheet the
 * containing block for every `fixed` descendant, and sheets now contain drawers.
 *
 * Only rendered on the compact layout — desktop surfaces keep their inline panels and wrappers.
 */
export function Sheet({ label, onClose, children, fullScreen = false, scrollBody = false, collapsed = false }: SheetProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  // A collapsed sheet has focus out on the grid mid-drag, so Escape reaches dnd-kit and cancels
  // the drag instead of closing the sheet: intended.
  const onKeyDown = useFocusTrap(dialogRef, { onEscape: onClose });

  const frameClass = fullScreen ? `${FRAME} h-dvh` : `${FRAME} h-[70dvh] rounded-t-[18px]`;
  const bodyClass = scrollBody
    ? 'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2'
    : 'flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain px-2 pb-2';

  return (
    <div
      data-testid="sheet-backdrop"
      onClick={collapsed ? undefined : onClose}
      className={collapsed ? 'pointer-events-none fixed inset-0 z-50' : 'fixed inset-0 z-50 bg-black/30'}
    >
      <div
        ref={dialogRef}
        data-testid="sheet"
        role="dialog"
        // Collapsed, the sheet is a strip over a live grid the user is dragging on -- claiming the
        // rest of the page is inert would be a lie to assistive tech.
        aria-modal={!collapsed}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        // Collapsed for a drag, 56px of the sheet stays on screen: a strip tall enough to grab back.
        className={`${frameClass} ${collapsed ? 'translate-y-[calc(100%_-_56px)]' : ''}`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2">
          <span className="w-11" />
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
          <button
            type="button"
            data-testid="sheet-close"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[9px] text-inkSoft"
          >
            ✕
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
