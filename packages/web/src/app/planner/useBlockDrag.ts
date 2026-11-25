import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { IDLE, beginPress, pressMove, pressArm, endPress, isArmed, isTap, LONG_PRESS_MS, type PressState } from './longPress';
import { useEdgeAutoScroll } from './edgeScroll';
import { pastThreshold } from './dragModel';

export type DragMode = 'move' | 'resize';

/** A live gesture, in CLIENT pixels (scroll compensation folded into `dy`). */
export interface LiveDrag {
  mode: DragMode;
  dx: number;
  dy: number;
  /** One rendered column (client px) — the block layer's width over the day count. */
  colWidth: number;
  /** Layer render scale (`rect.width / offsetWidth`), 1 when unknown. */
  scale: number;
}

export interface UseBlockDragOptions {
  /** Rendered day columns: the block layer spans all of them. */
  dayCount: number;
  /** Coarse primary pointer: a touch body press waits for a long press before it arms. */
  coarse: boolean;
  getScrollContainer?: () => HTMLElement | null;
  /** A press that did not drag (mouse under the threshold, or a touch released before arming). */
  onTap: () => void;
  /** Release of a real drag, with the final live gesture. The caller decides what it commits. */
  onRelease: (drag: LiveDrag) => void;
  /** Fires once when a gesture takes the pointer (before any preview) — flush pending edits here. */
  onGrab?: () => void;
}

export interface BlockDrag {
  /** The live gesture once it is a drag (past the threshold / armed by a long press), else null. */
  live: LiveDrag | null;
  /** A pointer is down (including a press still under the threshold or awaiting its long press). */
  pressed: boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  resizeHandlers: { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void };
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Once a touch drag is armed the browser must stop treating the gesture as a scroll. `touch-action`
 * is latched when the finger lands, so flipping a class at arm time is too late — the only way out
 * mid-gesture is a non-passive touchmove listener that preventDefaults. Module-level so the
 * add/remove pair always sees the same function identity.
 */
const blockTouchScroll = (e: TouchEvent): void => { e.preventDefault(); };

interface Gesture {
  mode: DragMode;
  startX: number;
  startY: number;
  colWidth: number;
  scale: number;
  scrollStart: number;
  /** Live preview on (past the threshold, a long press armed it, or a resize moved). */
  dragging: boolean;
  /** Travel ever crossed the threshold: a release commits rather than taps. */
  travelled: boolean;
  lastX: number;
  lastY: number;
}

/**
 * The pointer machinery of a movable planner block (spec §5.2), framework-only: it reports a live
 * gesture in client pixels and leaves geometry to `dragModel` and rendering to the block.
 *
 * Kept from the pre-redesign InteractiveBlock: long-press arming on touch (`longPress.ts`),
 * first-pointer-wins capture, the non-passive touchmove block, edge auto-scroll with scroll
 * compensation, and tap detection. New: a mouse press becomes a drag only past 5px of travel
 * (`pastThreshold`), so a click never twitches the tile, and a drag released where it started
 * commits nothing and is not a click either.
 */
export function useBlockDrag({ dayCount, coarse, getScrollContainer, onTap, onRelease, onGrab }: UseBlockDragOptions): BlockDrag {
  const gestureRef = useRef<Gesture | null>(null);
  const pressRef = useRef<PressState>(IDLE);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
  const [live, setLive] = useState<LiveDrag | null>(null);
  const [pressed, setPressed] = useState(false);
  // Latest callbacks for handlers created during an older render.
  const cb = useRef({ onTap, onRelease, onGrab });
  cb.current = { onTap, onRelease, onGrab };

  const scrollDelta = (g: Gesture): number => {
    const el = getScrollContainer?.();
    return el ? el.scrollTop - g.scrollStart : 0;
  };

  /** Past the threshold, counting content scrolled under a still pointer as travel. */
  const travelledFar = (g: Gesture): boolean => pastThreshold(g.lastX - g.startX, g.lastY - g.startY + scrollDelta(g));

  const snapshot = (g: Gesture): LiveDrag => ({
    mode: g.mode,
    dx: g.lastX - g.startX,
    dy: g.lastY - g.startY + scrollDelta(g),
    colWidth: g.colWidth,
    scale: g.scale,
  });

  // The rAF loop scrolls the grid even when the finger is still, so it must also refresh the
  // preview — otherwise the tile rides the content away from the finger and pointer-up would
  // commit a position the preview never showed.
  const edgeScroll = useEdgeAutoScroll(
    () => getScrollContainer?.() ?? null,
    () => {
      const g = gestureRef.current;
      if (g?.dragging) setLive(snapshot(g));
    },
  );

  const clearPressTimer = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  const releaseCapture = () => {
    const cap = captureRef.current;
    captureRef.current = null;
    if (!cap) return;
    cap.el.removeEventListener('touchmove', blockTouchScroll);
    if (typeof cap.el.releasePointerCapture === 'function') {
      try { cap.el.releasePointerCapture(cap.pointerId); } catch { /* not captured */ }
    }
  };

  const capture = (el: HTMLElement, pointerId: number) => {
    // Idempotent: re-arming while a capture is live would leak the previous touchmove listener.
    releaseCapture();
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(pointerId); } catch { /* jsdom / unsupported */ }
    }
    el.addEventListener('touchmove', blockTouchScroll, { passive: false });
    captureRef.current = { el, pointerId };
  };

  const reset = () => {
    clearPressTimer();
    releaseCapture();
    edgeScroll.stop();
    pressRef.current = endPress();
    gestureRef.current = null;
    setLive(null);
    setPressed(false);
  };

  useEffect(() => () => {
    clearPressTimer();
    const cap = captureRef.current;
    if (cap) cap.el.removeEventListener('touchmove', blockTouchScroll);
  }, []);

  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    // Primary button only (a right-click opens the context menu, it never drags).
    if (e.button != null && e.button > 0) return;
    // A second finger landing while the first owns the gesture is ignored outright: the gesture
    // is single-slot, so letting pointer 2 re-seed it would make pointer 1's release commit a
    // bogus time. First pointer down wins until it lifts or cancels.
    if (captureRef.current !== null || gestureRef.current !== null) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    // A leftover text selection that covers this tile would turn the press into a native drag of
    // that selection, and the browser then cancels our pointer (pointercancel) mid-gesture.
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
    cb.current.onGrab?.();
    // Deferral is decided per *event*, not per device: `coarse` is the primary-pointer media query,
    // so an iPad with a trackpad reports coarse while the mouse in hand is fine. A mouse never
    // waits; a touch always does. Only a body *move* defers — the resize handle is unambiguous.
    const deferred = (coarse || e.pointerType === 'touch') && e.pointerType !== 'mouse' && mode === 'move';
    pressRef.current = beginPress(finite(e.clientX), finite(e.clientY), deferred);
    const layer = el.closest<HTMLElement>('[data-testid="block-layer"]') ?? el.parentElement;
    const rect = layer?.getBoundingClientRect();
    const width = rect?.width ?? 0;
    const offset = layer?.offsetWidth ?? 0;
    gestureRef.current = {
      mode,
      startX: finite(e.clientX),
      startY: finite(e.clientY),
      colWidth: width / Math.max(1, dayCount),
      scale: offset > 0 && width > 0 ? width / offset : 1,
      scrollStart: getScrollContainer?.()?.scrollTop ?? 0,
      dragging: false,
      travelled: false,
      lastX: finite(e.clientX),
      lastY: finite(e.clientY),
    };
    clearPressTimer();
    setPressed(true);
    if (isArmed(pressRef.current)) { capture(el, pointerId); return; }
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      pressRef.current = pressArm(pressRef.current);
      const g = gestureRef.current;
      if (!isArmed(pressRef.current) || !g) return;
      capture(el, pointerId);
      // The long press IS the pick-up: lift now, before any travel.
      g.dragging = true;
      setLive(snapshot(g));
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    pressRef.current = pressMove(pressRef.current, finite(e.clientX), finite(e.clientY));
    if (pressRef.current.phase === 'idle') {
      // Travelled before the long press armed → the user is scrolling. Hand the gesture back.
      reset();
      return;
    }
    if (!isArmed(pressRef.current)) return; // still counting down: no preview, no capture
    g.lastX = finite(e.clientX);
    g.lastY = finite(e.clientY);
    if (travelledFar(g)) g.travelled = true;
    // A move waits for the threshold; a resize has no click to tell apart and follows at once.
    if (!g.dragging && !g.travelled && g.mode === 'move') return;
    g.dragging = true;
    edgeScroll.update(g.lastY);
    setLive(snapshot(g));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    if (isTap(pressRef.current)) { reset(); cb.current.onTap(); return; } // released before the long press
    g.lastX = finite(e.clientX);
    g.lastY = finite(e.clientY);
    // A fast press can arrive with no pointermove at all; the release position still counts.
    if (travelledFar(g)) g.travelled = true;
    const final = snapshot(g);
    const { mode, travelled } = g;
    reset();
    // A move that never crossed the threshold is a click (also a long press lifted in place). A
    // move that did is a drag even when released back at its origin — the caller no-ops that.
    if (mode === 'move' && !travelled) { cb.current.onTap(); return; }
    cb.current.onRelease(final);
  };

  const onPointerCancel = () => { reset(); };

  return {
    live,
    pressed,
    handlers: { onPointerDown: begin('move'), onPointerMove, onPointerUp, onPointerCancel },
    resizeHandlers: { onPointerDown: begin('resize') },
  };
}
