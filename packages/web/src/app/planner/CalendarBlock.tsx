import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Icons } from '../shell/icons';
import { blockVariant, type BlockKind } from './blockStyle';

/** Below this a tile is too short for two lines: title left, start time right (spec §3). */
export const ROW_LAYOUT_MAX_MIN = 45;

type PointerHandler = (e: ReactPointerEvent<HTMLElement>) => void;

export interface CalendarBlockProps {
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
  /** Pointer handlers for the drag machinery (InteractiveBlock) — on the wrapper. */
  onPointerDown?: PointerHandler;
  onPointerMove?: PointerHandler;
  onPointerUp?: PointerHandler;
  onPointerCancel?: PointerHandler;
  /** Bottom-edge resize hit area. Absent on locked tiles. */
  resize?: { onPointerDown: PointerHandler; className: string };
  /** Overlays (the live drag label). */
  children?: ReactNode;
}

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
    title, kind, source = null, pinned = false, started = false, accent, startLabel, whenLabel, durationMin,
    style, className = '', dayIndex, selected = false, coarse = false, onDelete, deleteLabel = 'Delete block',
    onUnpin, onBodyClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, resize, children,
  } = props;
  const v = blockVariant({ kind, source, pinned, started, accent });
  const row = durationMin < ROW_LAYOUT_MAX_MIN;
  const state = v.locked ? 'locked, synced from Google' : 'movable, drag to reschedule';
  const ariaLabel = [title, whenLabel, state].filter(Boolean).join(', ');
  const hasCluster = v.icon !== null || onDelete !== undefined;

  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      data-locked={v.locked}
      data-source={source ?? undefined}
      data-started={started}
      data-selected={selected}
      data-day-index={dayIndex}
      title={`${startLabel} ${title}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`group pointer-events-auto absolute overflow-hidden rounded-event ${v.className} ${selected ? 'z-[3] outline outline-2 outline-offset-2 outline-fg' : ''} ${className}`}
      style={{ ...style, ...v.style }}
    >
      {started && <span aria-hidden="true" data-testid="started-bar" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
      <button
        type="button"
        data-testid="block-body"
        aria-label={ariaLabel}
        onClick={onBodyClick}
        // Room on the right for a visible lock/pin; the hover-only × may overlap the time.
        className={`flex h-full w-full min-w-0 cursor-[inherit] text-left focus-visible:outline-offset-[-3px] ${row
          ? `flex-row items-center justify-between gap-1.5 px-[9px] ${v.icon ? 'pr-7' : ''}`
          : `flex-col items-start gap-px px-[9px] py-1.5 ${v.icon ? 'pr-7' : ''}`}`}
      >
        {row ? (
          <>
            <span className="min-w-0 truncate text-[13px] font-medium leading-tight">{title}</span>
            <span className="shrink-0 text-[11px] tabular-nums opacity-80">{startLabel}</span>
          </>
        ) : (
          <>
            <span className="whitespace-nowrap text-[11px] tabular-nums opacity-80">{startLabel}</span>
            <span className="min-w-0 text-[13px] font-medium leading-tight [overflow-wrap:anywhere]">{title}</span>
          </>
        )}
      </button>
      {hasCluster && (
        <span className={`absolute right-1.5 z-10 flex items-center gap-1 ${row ? 'top-1/2 -translate-y-1/2' : 'top-1.5'}`}>
          {onDelete && (
            <button
              type="button"
              aria-label={deleteLabel}
              title="Delete"
              data-always-visible={coarse}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className={`${DELETE_BTN} ${coarse ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}
            >
              ×
            </button>
          )}
          {v.icon === 'lock' && <span data-icon="lock" aria-hidden="true" className="opacity-80"><Icons.lock size={12} /></span>}
          {v.icon === 'pin' && (onUnpin ? (
            <button
              type="button"
              aria-label="Unpin"
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
        </span>
      )}
      {children}
      {resize && (
        <span
          data-testid="resize-handle"
          onPointerDown={resize.onPointerDown}
          className={`absolute inset-x-0 bottom-0 z-[2] cursor-ns-resize after:absolute after:bottom-[3px] after:left-1/2 after:h-[3px] after:w-[22px] after:-translate-x-1/2 after:rounded-full after:bg-current after:opacity-0 after:transition-opacity after:content-[''] group-hover:after:opacity-75 ${resize.className}`}
        />
      )}
    </div>
  );
}
