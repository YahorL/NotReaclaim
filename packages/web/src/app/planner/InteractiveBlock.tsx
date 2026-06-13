import { useState, useRef, useEffect, useLayoutEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta } from './weekModel';

const MIN_DURATION_MIN = 15;
const HELD_TIMEOUT_MS = 1500;
const iso = (ms: number): string => new Date(ms).toISOString();
const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

export interface InteractiveBlockProps {
  id: string;
  dayStartMs: number;
  dayIndex: number;
  startMs: number;
  endMs: number;
  topPct: number;
  heightPct: number;
  startLabel: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  onCommit: (patch: { startsAt: string; endsAt: string; pinned: boolean }) => void;
  onUnpin?: () => void;
  onDelete?: () => void;
  accent?: string;
}

type DragMode = 'move' | 'resize';

export function InteractiveBlock(props: InteractiveBlockProps) {
  // `id` is part of the props for the parent's onCommit binding; not read inside this component.
  const { dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit, onUnpin, onDelete, accent } = props;
  // Refs hold the authoritative drag state; mutated directly so pointer handlers always
  // see the latest values regardless of React's batching/commit schedule.
  const modeRef = useRef<DragMode | null>(null);
  const startYRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const colWidthRef = useRef<number>(0);
  // State is used only to trigger re-renders for the snapped CSS preview.
  const [moveMin, setMoveMin] = useState(0);
  const [growMin, setGrowMin] = useState(0);
  const [dayDelta, setDayDelta] = useState(0);
  // activeDrag: true only while a drag is in progress (cleared on pointer-up/cancel)
  const [activeDrag, setActiveDrag] = useState(false);
  // Held preview: persists the committed deltas after pointer-up until props change or timeout
  const [heldMove, setHeldMove] = useState(0);
  const [heldGrow, setHeldGrow] = useState(0);
  const [heldDay, setHeldDay] = useState(0);
  const [heldColWidth, setHeldColWidth] = useState(0);
  // `landing`: the single frame where the committed top/height first paints. We keep the
  // transition OFF for that frame so the transform→0 + top→newTop swap paints with NO
  // animation (they cancel → no movement), THEN restore the replan glide a frame later.
  const [landing, setLanding] = useState(false);
  // Mirror of "is a held preview active" readable synchronously inside the layout effect
  // (whose deps are only [startMs,endMs] — it must not list the held state or it would
  // re-run and clear the preview the instant pointer-up sets it).
  const heldActiveRef = useRef(false);
  // Safety timeout ref for held preview
  const heldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Clear the held preview when startMs/endMs change (the optimistic commit landed).
  // CRITICAL: clearing it here would, on its own, restore `transition-[top,height]` on the
  // very render that moves `top` to its new value — the browser then animates top old→new
  // while transform snaps to 0, i.e. the block jumps back to the start and glides to the
  // end. So when this clear follows a real drag (heldActiveRef), we enter `landing`: keep
  // the transition off for the landed paint, then drop `landing` next frame.
  useLayoutEffect(() => {
    if (heldTimerRef.current) {
      clearTimeout(heldTimerRef.current);
      heldTimerRef.current = null;
    }
    const wasHeld = heldActiveRef.current;
    heldActiveRef.current = false;
    setHeldMove(0);
    setHeldGrow(0);
    setHeldDay(0);
    setHeldColWidth(0);
    if (wasHeld) {
      setLanding(true);
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
      if (raf) {
        rafRef.current = raf(() => { rafRef.current = raf(() => setLanding(false)); });
      } else {
        setLanding(false);
      }
    }
  }, [startMs, endMs]);

  // Clean up timer / rAF on unmount
  useEffect(() => {
    return () => {
      if (heldTimerRef.current) clearTimeout(heldTimerRef.current);
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const clearHeld = () => {
    // Safety-timeout path (e.g. a failed mutation rolled back to identical props so the
    // layout effect never fired): just drop the offset. No `landing` — letting the replan
    // transition glide the block back to its original slot is the right feel for a rollback.
    heldActiveRef.current = false;
    setHeldMove(0);
    setHeldGrow(0);
    setHeldDay(0);
    setHeldColWidth(0);
    heldTimerRef.current = null;
  };

  const holdPreview = (hm: number, hg: number, hd: number, hw: number) => {
    if (heldTimerRef.current) clearTimeout(heldTimerRef.current);
    heldActiveRef.current = true;
    setHeldMove(hm);
    setHeldGrow(hg);
    setHeldDay(hd);
    setHeldColWidth(hw);
    // Safety timeout: clear held preview after 1.5s (covers failed mutations that
    // roll back to identical props — the useEffect won't fire in that case)
    heldTimerRef.current = setTimeout(clearHeld, HELD_TIMEOUT_MS);
  };

  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    }
    modeRef.current = mode;
    startYRef.current = finite(e.clientY);
    startXRef.current = finite(e.clientX);
    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;
    setActiveDrag(true);
  };

  const snappedDy = (clientY: number): number => snapMinutes(pxToMinutes(finite(clientY) - startYRef.current));

  const snappedDx = (clientX: number): number => {
    const w = colWidthRef.current;
    if (w <= 0) return 0;
    return clampDayDelta(dayIndex, Math.round((finite(clientX) - startXRef.current) / w));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!modeRef.current) return;
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setDayDelta(snappedDx(e.clientX)); setGrowMin(0); }
    else { setGrowMin(min); setMoveMin(0); setDayDelta(0); }
  };

  const resetDragState = () => {
    modeRef.current = null;
    startYRef.current = 0;
    startXRef.current = 0;
    colWidthRef.current = 0;
    setActiveDrag(false);
    setMoveMin(0);
    setGrowMin(0);
    setDayDelta(0);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const deltaMin = snappedDy(e.clientY);
    const deltaDays = modeRef.current === 'move' ? snappedDx(e.clientX) : 0;
    const mode = modeRef.current;
    // Capture current live drag deltas and column width before resetting
    const captureMoveMin = moveMin;
    const captureGrowMin = growMin;
    const captureDayDelta = dayDelta;
    const captureColWidth = colWidthRef.current;

    resetDragState();

    if (!mode) return;

    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;

    if (mode === 'move') {
      if (deltaMin === 0 && deltaDays === 0) return; // zero-delta no-op: no held preview
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      const dayStart = shiftDays(dayStartMs, deltaDays);
      // Transfer to held preview before firing mutation
      holdPreview(captureMoveMin, 0, captureDayDelta, captureColWidth);
      onCommit({ startsAt: iso(dayStart + moved.startMin * 60_000), endsAt: iso(dayStart + moved.endMin * 60_000), pinned: true });
    } else {
      const newEndMin = Math.min(WINDOW_END_MIN, Math.max(startMin + MIN_DURATION_MIN, endMin + deltaMin));
      if (newEndMin === endMin) return; // zero-delta no-op: no held preview
      // Transfer to held preview before firing mutation
      holdPreview(0, captureGrowMin, 0, 0);
      onCommit({ startsAt: iso(startMs), endsAt: iso(dayStartMs + newEndMin * 60_000), pinned: true });
    }
  };

  const onPointerCancel = () => { resetDragState(); };

  // During active drag, use live state deltas; otherwise show held preview
  const effectiveMoveMin = activeDrag ? moveMin : heldMove;
  const effectiveGrowMin = activeDrag ? growMin : heldGrow;
  const effectiveDayDelta = activeDrag ? dayDelta : heldDay;
  const effectiveColWidth = activeDrag ? colWidthRef.current : heldColWidth;

  // The drag label shows only during active drag AND when there is a non-zero live delta.
  const showDragLabel = activeDrag && (moveMin !== 0 || growMin !== 0 || dayDelta !== 0);

  const previewStart = startMs + effectiveMoveMin * 60_000;
  const previewEnd = effectiveGrowMin !== 0 ? endMs + effectiveGrowMin * 60_000 : endMs + effectiveMoveMin * 60_000;

  const accentStyles = accent && kind !== 'meeting'
    ? pinned
      ? { backgroundColor: accent }
      : { borderColor: accent, color: accent }
    : {};

  const transformX = effectiveDayDelta * effectiveColWidth;
  const transformY = minutesToPx(effectiveMoveMin);
  const heightDelta = minutesToPx(effectiveGrowMin);

  // Transition classes:
  // - active drag: transition-transform duration-75 (fluid ticks), no top/height transition (no lag)
  // - held (post-drag, before props land) OR landing (the committed paint): transition-none, so
  //   the transform→0 + top→newTop swap paints with no animation — kills the jump-to-initial.
  // - idle: transition-[top,height] duration-300 ease-out (replan animations for actual replans)
  const held = heldMove !== 0 || heldGrow !== 0 || heldDay !== 0;
  const transitionClass = activeDrag
    ? 'transition-transform duration-75'
    : (held || landing)
      ? 'transition-none'
      : 'transition-[top,height] duration-300 ease-out';

  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`group ${BASE} ${activeDrag ? 'cursor-grabbing' : 'cursor-grab'} select-none ${variantClass(kind, pinned, accent)} ${transitionClass}`}
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${heightDelta}px)`, transform: `translate(${transformX}px, ${transformY}px)`, ...accentStyles }}
    >
      {onDelete && !activeDrag && (
        <button
          type="button"
          aria-label="Delete block"
          title="Delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white group-hover:flex hover:bg-black/45"
        >
          ×
        </button>
      )}
      {pinned && (
        onUnpin
          ? (
            <button
              type="button"
              aria-label="Unpin"
              title="Unpin — let the scheduler move this"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onUnpin(); }}
              className="mr-0.5 cursor-pointer border-0 bg-transparent p-0 leading-none"
            >
              🔒
            </button>
          )
          : <span aria-hidden="true">🔒 </span>
      )}
      <span className="font-medium">{startLabel}</span> {title}
      {showDragLabel && (
        <span data-testid="drag-label" className="absolute right-1 top-0.5 rounded bg-ink/70 px-1 text-[10px] font-semibold text-white">
          {fmtTime(previewStart)} – {fmtTime(previewEnd)}
        </span>
      )}
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
    </div>
  );
}
