import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, TransitionEvent as ReactTransitionEvent } from 'react';
import { Icons } from '../shell/icons';
import { blockVariant, type BlockKind } from './blockStyle';

/** Below this a tile is too short for two lines: title left, start time right (spec §3). */
export const ROW_LAYOUT_MAX_MIN = 45;

type PointerHandler = (e: ReactPointerEvent<HTMLElement>) => void;

export interface CalendarBlockProps {
  /** `b:<id>` / `e:<id>`, exposed as data-block-key. */
  blockKey?: string;
  title: string;
  kind: BlockKind;
  source?: 'app' | 'google' | null;
  pinned?: boolean;
  started?: boolean;
  accent?: string;
  /** Start time label ("09:00 AM"), in the settings zone. */
  startLabel: string;
  /** "Wed 09:00 AM – 10:00 AM" — the when-part of the body's accessible name. */
  whenLabel?: string;
  /** Rendered duration, for the one-row layout of short tiles. */
  durationMin: number;
  /** Position/size (and, for a drag preview, transform) — set by the layer. */
  style: CSSProperties;
  /** Extra wrapper classes: transitions, cursor, lift. */
  className?: string;
  /** Rendered day column, for tests and the detail card. */
  dayIndex?: number;
  selected?: boolean;
  /** Coarse pointer: no hover, so the delete × is always visible. */
  coarse?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
  /** Pinned tiles: the pin becomes an Unpin button. */
  onUnpin?: () => void;
  /** Click on the body (a static tile's select; on movable tiles only keyboard activation). */
  onBodyClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Keys on the focused body: arrows move / resize (spec §5.2), Delete deletes. */
  onBodyKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onBodyBlur?: (e: ReactFocusEvent<HTMLButtonElement>) => void;
  /** id of the planner's shared, visually hidden keyboard instructions. */
  describedBy?: string;
  /** Pointer handlers for the drag machinery (InteractiveBlock) — on the wrapper. */
  onPointerDown?: PointerHandler;
  onPointerMove?: PointerHandler;
  onPointerUp?: PointerHandler;
  onPointerCancel?: PointerHandler;
  /** Bottom-edge resize hit area. Absent on locked tiles. */
  resize?: { onPointerDown: PointerHandler; className: string };
  /**
   * Motion state (spec §5.2). `idle`: the spring transitions on top/left/width/height/transform
   * are always on, so a release, a replan or a keyboard move glides. `dragging` / `resizing`: the
   * tile follows the pointer exactly, so geometry transitions are off and it lifts.
   */
  motion?: BlockMotion;
  /** Springing into its slot after a release: stays above its neighbours until it lands. */
  settling?: boolean;
  /** Locked tile refusing a move: one `animate-shake` run. */
  shake?: boolean;
  /** Newly placed by a Re-plan: drops in (`animate-land`) after this delay (spec §5.5). */
  landDelayMs?: number;
  /** First load / paging: pops in (`animate-ev-in`) after this delay (spec §5.6). */
  enterDelayMs?: number;
  /** Filtered out (Meetings / Movable toggles): faded and scaled away, inert, out of the tab
   *  order and the accessibility tree — but still mounted, so it can animate back. */
  hidden?: boolean;
  onTransitionEnd?: (e: ReactTransitionEvent<HTMLDivElement>) => void;
  /** Overlays (the live drag label). */
  children?: ReactNode;
}

export type BlockMotion = 'idle' | 'dragging' | 'resizing';

/**
 * Idle transitions — the prototype's `.ev` curves (move/resize/fade). One literal string so the
 * JIT sees it; the reduced-motion kill switch collapses every duration to ~0.
 */
const SPRING = '[transition:top_var(--dur-move)_var(--ease-spring),left_var(--dur-move)_var(--ease-spring),width_var(--dur-move)_var(--ease-spring),height_var(--dur-resize)_var(--ease-spring-strong),transform_var(--dur-move)_var(--ease-spring),opacity_.3s_ease,box-shadow_.25s_ease]';
/** Picked up: no geometry transition (it follows the pointer), big shadow + accent ring. */
const LIFTED = 'z-20 shadow-lift ring-[1.5px] ring-accent/70 transition-[box-shadow] duration-200';
const MOTION_CLASS: Record<BlockMotion, string> = {
  idle: SPRING,
  dragging: `${LIFTED} cursor-grabbing`,
  resizing: LIFTED,
};

/** Hover × — sibling of the focus target, never inside it. */
const DELETE_BTN = 'h-[18px] w-[18px] items-center justify-center rounded-full bg-black/30 text-[12px] leading-none text-white hover:bg-black/50';

/**
 * One planner tile, any kind. A positioned wrapper (`event-block`, the visible surface and the
 * data-* state) holding a focusable body button plus sibling actions (× delete, pin/Unpin) and the
 * resize handle. Static by itself: drag/resize logic lives in InteractiveBlock, which renders
 * through this and hands its pointer handlers to the wrapper.
 */
export function CalendarBlock(props: CalendarBlockProps) {
  const {
    blockKey, title, kind, source = null, pinned = false, started = false, accent, startLabel, whenLabel, durationMin,
    style, className = '', dayIndex, selected = false, coarse = false, onDelete, deleteLabel = 'Delete block',
    onUnpin, onBodyClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, resize, children,
    motion = 'idle', settling = false, shake = false, hidden = false, landDelayMs, enterDelayMs, onTransitionEnd, onBodyKeyDown, onBodyBlur, describedBy,
  } = props;
  const v = blockVariant({ kind, source, pinned, started, accent });
  // A drag owns the transform; a landing animation would fight it.
  const landing = landDelayMs !== undefined && motion === 'idle';
  const entering = !landing && enterDelayMs !== undefined && motion === 'idle';
  const row = durationMin < ROW_LAYOUT_MAX_MIN;
  const state = v.locked ? 'locked, synced from Google' : 'movable: drag or use arrow keys, Shift+arrows to resize';
  const ariaLabel = [title, whenLabel, state].filter(Boolean).join(', ');
  const hasCluster = v.icon !== null || onDelete !== undefined;
  // Right padding for what is always visible in the corner cluster: the lock/pin, plus the ×
  // on a coarse pointer (no hover there). A hover-only × may overlap the text for a moment.
  const reserved = (v.icon ? 1 : 0) + (coarse && onDelete ? 1 : 0);
  const reserve = reserved === 2 ? 'pr-11' : reserved === 1 ? 'pr-6' : '';

  return (
    <div
      data-testid="event-block"
      data-block-key={blockKey}
      data-kind={kind}
      data-pinned={pinned}
      data-locked={v.locked}
      data-source={source ?? undefined}
      data-started={started}
      data-selected={selected}
      data-day-index={dayIndex}
      data-dragging={motion === 'dragging' ? 'true' : undefined}
      data-resizing={motion === 'resizing' ? 'true' : undefined}
      data-settling={settling ? 'true' : undefined}
      data-shake={shake ? 'true' : undefined}
      data-hidden={hidden ? 'true' : undefined}
      data-new={landing ? 'true' : undefined}
      data-entering={entering ? 'true' : undefined}
      aria-hidden={hidden ? true : undefined}
      title={`${startLabel} ${title}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTransitionEnd={onTransitionEnd}
      // A tile is never a native drag source: a browser drag (of a stray text selection that
      // covers the tile) would steal the pointer mid-gesture with a pointercancel.
      onDragStart={(e) => e.preventDefault()}
      className={`group select-none ${hidden ? 'pointer-events-none scale-[.92] opacity-0' : 'pointer-events-auto'} absolute overflow-hidden rounded-event ${v.className} ${MOTION_CLASS[motion]} ${settling ? 'z-20' : ''} ${shake ? 'animate-shake' : landing ? 'animate-land' : entering ? 'animate-ev-in' : ''} ${selected ? 'z-[3] outline outline-2 outline-offset-2 outline-fg' : ''} ${className}`}
      style={{ ...style, ...v.style, ...(landing ? { animationDelay: `${landDelayMs}ms` } : entering ? { animationDelay: `${enterDelayMs}ms` } : null) }}
    >
      {started && <span aria-hidden="true" data-testid="started-bar" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
      <button
        type="button"
        data-testid="block-body"
        tabIndex={hidden ? -1 : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={onBodyClick}
        onKeyDown={onBodyKeyDown}
        onBlur={onBodyBlur}
        // A button vertically CENTRES content taller than itself, which pushed the time label of a
        // short tile above its top edge. The full-height inner wrapper never overflows the button,
        // so long titles clip at the bottom instead.
        className="block h-full w-full min-w-0 cursor-[inherit] overflow-hidden text-left focus-visible:outline-offset-[-3px]"
      >
        {/* Room on the right for whatever sits in the corner cluster permanently (see `reserve`). */}
        <span className={`flex h-full w-full min-w-0 overflow-hidden ${row
          ? `flex-row items-center justify-between gap-1.5 px-[9px] ${reserve}`
          : `flex-col items-start justify-start gap-px px-[9px] ${durationMin < 60 ? 'py-1' : 'py-1.5'} ${reserve}`}`}
        >
          {row ? (
            <>
              <span className="min-w-0 truncate text-[13px] font-medium leading-tight">{title}</span>
              <span className="shrink-0 text-[11px] tabular-nums opacity-80">{startLabel}</span>
            </>
          ) : (
            <>
              <span className="max-w-full shrink-0 overflow-hidden whitespace-nowrap text-[11px] leading-[14px] tabular-nums opacity-80">{startLabel}</span>
              {/* Word-wrapped, never broken mid-word: a narrow overlap lane clips instead of stacking letters. */}
              <span className="min-w-0 max-w-full overflow-hidden text-[13px] font-medium leading-tight">{title}</span>
            </>
          )}
        </span>
      </button>
      {hasCluster && (
        <span className={`absolute right-1.5 z-10 flex items-center gap-1 ${row ? 'top-1/2 -translate-y-1/2' : 'top-1.5'}`}>
          {v.icon === 'lock' && <span data-icon="lock" aria-hidden="true" className="opacity-80"><Icons.lock size={12} /></span>}
          {v.icon === 'pin' && (onUnpin ? (
            <button
              type="button"
              aria-label="Unpin"
              tabIndex={hidden ? -1 : undefined}
              title="Unpin — let the scheduler move this"
              data-icon="pin"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onUnpin(); }}
              // `relative z-10` keeps it above the resize hit area, which on a coarse pointer
              // covers the bottom 24px of a short tile.
              className="relative z-10 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full opacity-80 hover:bg-fg/10 hover:opacity-100"
            >
              <Icons.pin size={12} />
            </button>
          ) : <span data-icon="pin" aria-hidden="true" className="opacity-80"><Icons.pin size={12} /></span>)}
          {/* Rightmost: in a narrow overlap lane the cluster overflows to the LEFT, and a ×
              pushed outside the tile would vanish (hover lost) before it could be clicked. */}
          {onDelete && (
            <button
              type="button"
              aria-label={deleteLabel}
              tabIndex={hidden ? -1 : undefined}
              title="Delete"
              data-always-visible={coarse}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className={`${DELETE_BTN} ${coarse ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}
            >
              ×
            </button>
          )}
        </span>
      )}
      {children}
      {resize && (
        // The grip pill (prototype `.rsz::after`): fades in on hover / keyboard focus, always
        // shown on touch (no hover), and widens 22 → 30px while resizing.
        <span
          data-testid="resize-handle"
          data-grip-visible={coarse ? 'true' : undefined}
          onPointerDown={resize.onPointerDown}
          className={`absolute inset-x-0 bottom-0 z-[2] cursor-ns-resize after:absolute after:bottom-[3px] after:left-1/2 after:h-[3px] after:w-[22px] after:-translate-x-1/2 after:rounded-full after:bg-current after:transition-[opacity,width] after:duration-200 after:content-[''] group-hover:after:opacity-75 group-focus-within:after:opacity-75 group-data-[resizing=true]:after:w-[30px] group-data-[resizing=true]:after:opacity-75 ${coarse ? 'after:opacity-50' : 'after:opacity-0'} ${resize.className}`}
        />
      )}
    </div>
  );
}
