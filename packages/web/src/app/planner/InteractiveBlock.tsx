import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type TransitionEvent as ReactTransitionEvent } from 'react';
import { CalendarBlock, type BlockMotion } from './CalendarBlock';
import type { BlockKind } from './blockStyle';
import { blockLeftCss, blockWidthCss } from './blockLayout';
import { GRID_COLUMN_PX, WINDOW_END_MIN, minuteToPct, formatHm, weekdayLabel, resizeHandleClass, shiftDays } from './weekModel';
import { moveTarget, resizeTarget, targetTimes, moveLabel, resizeLabel, type MoveInput } from './dragModel';
import { useBlockDrag, type LiveDrag } from './useBlockDrag';
import { keyboardChange } from './blockKeyboard';
import { useToast } from '../shell/ToastProvider';
import { MS_PER_MIN, toIso } from '../lib/time';
import { trackInputModality, lastInputModality } from '../lib/inputModality';

/** Fallback for `data-settling` when no transitionend arrives (nothing moved, hidden tab, jsdom). */
const SETTLE_FALLBACK_MS = 900;
/** Below this the raw resize height stops shrinking (prototype `max(12, h + dy)`). */
const MIN_RAW_HEIGHT_PX = 12;
const SETTLE_PROPS = new Set(['top', 'left', 'height', 'transform']);
/** Arrow-key edits preview at once and commit once the keys go quiet (key-repeat must not flood). */
export const KEY_COMMIT_DEBOUNCE_MS = 400;
export const EDGE_HINT = 'Use the arrows above to see more days';

export interface InteractiveBlockProps {
  dayStartMs: number;
  dayIndex: number;
  startMs: number;
  endMs: number;
  topPct: number;
  heightPct: number;
  /** Horizontal lane position, in percent of the whole block layer (see blockLayout). */
  leftPct?: number;
  widthPct?: number;
  lane?: number;
  lanes?: number;
  startLabel: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  /** Calendar events only ('app' — Google events never reach this component). */
  source?: 'app' | 'google' | null;
  started?: boolean;
  selected?: boolean;
  onCommit: (patch: { startsAt: string; endsAt: string; pinned: boolean }) => void;
  /** Arrow-key preview before the debounced commit: the caller shows the block at these times. */
  onPreview?: (startMs: number, endMs: number) => void;
  /** id of the shared, visually hidden keyboard instructions. */
  describedBy?: string;
  /** Filtered out by the Meetings / Movable toggles (see CalendarBlock `hidden`). */
  hidden?: boolean;
  /** Newly placed by a Re-plan: drop-in delay (see CalendarBlock `landDelayMs`). */
  landDelayMs?: number;
  /** Entrance pop-in delay (see CalendarBlock `enterDelayMs`). */
  enterDelayMs?: number;
  onUnpin?: () => void;
  onDelete?: () => void;
  /** Fired on a press that did not drag — never alongside onCommit — and on keyboard activation
   *  of the block body (`keyboard` true). */
  onClick?: (keyboard: boolean) => void;
  /** `b:<id>` / `e:<id>` — exposed as data-block-key (focus restore after the detail card closes). */
  blockKey?: string;
  deleteLabel?: string;
  /** Rendered day columns: the block layer spans all of them, so one column = layer width / dayCount. */
  dayCount?: number;
  accent?: string;
  zone?: string;
  /** Coarse pointer: a body move waits for a long press before it arms. */
  coarse?: boolean;
  /** The vertically scrolling hours container, for edge auto-scroll and scroll compensation. */
  getScrollContainer?: () => HTMLElement | null;
}

/**
 * A movable planner tile (task / habit block, app event, blocked time): CalendarBlock plus the
 * spec §5.2 gesture model.
 *
 * - Drag: the tile follows the raw pointer (`translate(dx,dy) scale(1.05) rotate(-0.8deg)`, no
 *   geometry transition), while a dashed ghost (`drag-ghost`) previews the snapped target with a
 *   "Sat · 12:15 AM" pill (`drag-label`).
 * - Release: `onCommit` fires and the transform is dropped IN THE SAME RENDER that the target
 *   geometry arrives (the caller holds it — WeekGrid's pending overrides — until the data agrees),
 *   with the spring transition on. Transform and left/top animate together, so the tile springs
 *   from the drop point into the slot: there is no frame where it paints its new top from a stale
 *   offset (the R10/R11 release jump). Without a held target the same render springs it home.
 * - Resize: the height follows the pointer exactly; the ghost shows the snapped end.
 */
export function InteractiveBlock(props: InteractiveBlockProps) {
  const { blockKey, dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, leftPct = 0, widthPct = 100, lane = 0, lanes = 1, startLabel, title, kind, pinned, source = null, started = false, selected = false, onCommit, onPreview, describedBy, hidden = false, landDelayMs, enterDelayMs, onUnpin, onDelete, onClick, deleteLabel = 'Delete block', dayCount = 7, accent, zone = 'UTC', coarse = false, getScrollContainer } = props;
  const startMin = (startMs - dayStartMs) / MS_PER_MIN;
  const endMin = (endMs - dayStartMs) / MS_PER_MIN;
  const durationMin = endMin - startMin;

  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  const settle = () => {
    setSettling(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { settleTimer.current = null; setSettling(false); }, SETTLE_FALLBACK_MS);
  };
  const onTransitionEnd = (e: ReactTransitionEvent<HTMLDivElement>) => {
    // transitionend bubbles from the tile's children (the grip pill, hover ×); only ours counts.
    if (e.target !== e.currentTarget || !SETTLE_PROPS.has(e.propertyName)) return;
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    setSettling(false);
  };

  const moveInput = (d: LiveDrag): MoveInput => ({
    origDay: dayIndex, origStartMin: startMin, durationMin, dx: d.dx, dy: d.dy, colWidth: d.colWidth, dayCount, scale: d.scale,
  });

  const commit = (s: number, e: number) => {
    settle();
    onCommit({ startsAt: toIso(s), endsAt: toIso(e), pinned: true });
  };

  // ---- keyboard (spec §5.2): instant preview, ONE debounced commit, never dropped or doubled ----
  const toast = useToast();
  const keyPending = useRef<{ startMs: number; endMs: number } | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushKeys = () => {
    if (keyTimer.current) { clearTimeout(keyTimer.current); keyTimer.current = null; }
    const p = keyPending.current;
    keyPending.current = null;
    if (p) onCommit({ startsAt: toIso(p.startMs), endsAt: toIso(p.endMs), pinned: true });
  };
  // Unmount (paged away, filtered out of the data) flushes rather than drops the pending edit.
  const flushRef = useRef(flushKeys);
  flushRef.current = flushKeys;
  useEffect(() => () => flushRef.current(), []);

  // How the body got focus. A mouse click / touch focuses the button too, and the arrow keys must
  // then keep scrolling the hours rather than move (and pin) the tile the user merely clicked —
  // nor may Delete remove it. Set on every press, cleared on blur, so a Tab back in is keyboard.
  // Focus a script moves here (the detail card handing focus back as it closes) takes the last
  // input's modality: after a click on the card's ✕ it is pointer focus, after Escape keyboard.
  // (Not `:focus-visible`: browsers may start matching it on the very keypress we are reading.)
  const pointerFocus = useRef(false);
  useEffect(() => { trackInputModality(); }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (pointerFocus.current) return;
    // Delete only — Backspace is too easy to hit for a confirmation-free delete.
    if (e.key === 'Delete' && onDelete) {
      e.preventDefault();
      flushKeys();
      onDelete();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const change = keyboardChange(e.key, e.shiftKey, { dayIndex, startMin, endMin }, dayCount);
    if (!change) return;
    e.preventDefault(); // arrows would otherwise scroll the hours
    if ('edge' in change) { toast.show(EDGE_HINT); return; }
    if (change.dayIndex === dayIndex && change.startMin === startMin && change.endMin === endMin) return;
    const times = targetTimes({ dayStartMs, dayDelta: change.dayIndex - dayIndex, startMin: change.startMin, endMin: change.endMin, zone });
    keyPending.current = times;
    onPreview?.(times.startMs, times.endMs);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(flushKeys, KEY_COMMIT_DEBOUNCE_MS);
  };

  const drag = useBlockDrag({
    dayCount,
    coarse,
    getScrollContainer,
    onTap: () => onClick?.(false),
    // A pointer gesture starts from what the user sees: land any pending keyboard edit first.
    onGrab: flushKeys,
    onRelease: (d) => {
      if (d.mode === 'move') {
        const t = moveTarget(moveInput(d));
        if (t.dayIndex === dayIndex && t.startMin === startMin) return; // dropped where it was
        const times = targetTimes({ dayStartMs, dayDelta: t.dayIndex - dayIndex, startMin: t.startMin, endMin: t.startMin + durationMin, zone });
        commit(times.startMs, times.endMs);
      } else {
        const { endMin: newEnd } = resizeTarget({ startMin, origEndMin: endMin, dy: d.dy, scale: d.scale });
        if (newEnd === endMin) return; // zero-delta no-op
        commit(startMs, dayStartMs + newEnd * MS_PER_MIN);
      }
    },
  });

  const live = drag.live;
  const motion: BlockMotion = live ? (live.mode === 'move' ? 'dragging' : 'resizing') : 'idle';
  const scale = live?.scale ?? 1;

  // Live target + ghost (layer coordinates: the ghost is a sibling of the tile in the block layer).
  let shownStart = startLabel;
  let ghost: { top: string; height: string; left: string; width: string; label: string; labelInside: boolean } | null = null;
  let style: CSSProperties = {
    top: `${topPct}%`,
    height: `${heightPct}%`,
    left: blockLeftCss(leftPct, lane, lanes),
    width: blockWidthCss(widthPct, lane, lanes),
  };
  if (live?.mode === 'move') {
    const t = moveTarget(moveInput(live));
    const col = shiftDays(dayStartMs, t.dayIndex - dayIndex, zone);
    const s = col + t.startMin * MS_PER_MIN;
    shownStart = formatHm(s, zone);
    const n = Math.max(1, dayCount);
    ghost = {
      top: `${minuteToPct(t.startMin)}%`,
      // The block keeps its length; the part past the column end is clipped like the tile is.
      height: `${minuteToPct(Math.min(WINDOW_END_MIN, t.startMin + durationMin)) - minuteToPct(t.startMin)}%`,
      left: blockLeftCss((t.dayIndex / n) * 100, 0, 1),
      width: blockWidthCss(100 / n, 0, 1),
      label: moveLabel(col, s, zone),
      labelInside: t.startMin < 30, // the pill above would clip at the top of the hours
    };
    // The tile itself follows the raw pointer (layout px), lifted and tilted.
    style = { ...style, transform: `translate(${live.dx / scale}px, ${live.dy / scale}px) scale(1.05) rotate(-0.8deg)` };
  } else if (live?.mode === 'resize') {
    const { endMin: snappedEnd } = resizeTarget({ startMin, origEndMin: endMin, dy: live.dy, scale });
    const rawPx = Math.max(MIN_RAW_HEIGHT_PX, (heightPct / 100) * GRID_COLUMN_PX + live.dy / scale);
    style = { ...style, height: `${rawPx}px` };
    ghost = {
      top: `${topPct}%`,
      height: `${minuteToPct(Math.min(WINDOW_END_MIN, snappedEnd)) - minuteToPct(startMin)}%`,
      left: style.left as string,
      width: style.width as string,
      label: resizeLabel(snappedEnd - startMin, dayStartMs + snappedEnd * MS_PER_MIN, zone),
      labelInside: startMin < 30,
    };
  }

  return (
    <>
      <CalendarBlock
        blockKey={blockKey}
        title={title}
        kind={kind}
        source={source}
        pinned={pinned}
        started={started}
        accent={accent}
        startLabel={shownStart}
        whenLabel={`${weekdayLabel(startMs, zone)} ${formatHm(startMs, zone)} – ${formatHm(endMs, zone)}`}
        durationMin={durationMin}
        dayIndex={dayIndex}
        selected={selected}
        coarse={coarse}
        onDelete={live ? undefined : onDelete}
        deleteLabel={deleteLabel}
        onUnpin={onUnpin}
        // Pointer presses are discriminated by the drag machinery (a press under the threshold →
        // onClick), so the body's own click only counts when the keyboard produced it (detail 0).
        // A real mouse click after a short drag must never select.
        onBodyClick={(e) => { if (e.detail === 0) onClick?.(true); }}
        onBodyKeyDown={onKeyDown}
        onBodyBlur={() => { pointerFocus.current = false; flushKeys(); }}
        onBodyFocus={() => { if (lastInputModality() === 'pointer') pointerFocus.current = true; }}
        describedBy={describedBy}
        {...drag.handlers}
        onPointerDown={(e) => { pointerFocus.current = true; drag.handlers.onPointerDown(e); }}
        motion={motion}
        pressed={drag.pressed}
        settling={settling}
        hidden={hidden}
        landDelayMs={landDelayMs}
        enterDelayMs={enterDelayMs}
        onTransitionEnd={onTransitionEnd}
        className={`${live ? '' : 'cursor-grab'} select-none ${coarse ? 'touch-pan-y' : ''}`}
        style={style}
        // `touch-none` on the handle: a finger that lands there is a resize from the first pixel.
        resize={{ onPointerDown: (e) => { pointerFocus.current = true; drag.resizeHandlers.onPointerDown(e); }, className: `${resizeHandleClass(heightPct, coarse)} ${coarse ? 'touch-none' : ''}` }}
      />
      {ghost && (
        <div
          data-testid="drag-ghost"
          aria-hidden="true"
          className="pointer-events-none absolute z-[4] rounded-event border-[1.5px] border-dashed border-accent-fg bg-accent-fg/[.08] transition-[top,left] duration-[140ms] ease-out"
          style={{ top: ghost.top, height: ghost.height, left: ghost.left, width: ghost.width }}
        >
          <span
            data-testid="drag-label"
            className={`absolute ${ghost.labelInside ? 'left-1 top-1' : '-top-6 left-0'} whitespace-nowrap rounded-pill bg-accent px-2 py-[3px] text-[11px] font-bold text-on-accent shadow-[0_6px_14px_-6px_rgb(var(--c-accent-glow)/0.9)]`}
          >
            {ghost.label}
          </span>
        </div>
      )}
    </>
  );
}
