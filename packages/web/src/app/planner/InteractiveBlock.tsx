import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, clampToWindow } from './weekModel';

const MIN_DURATION_MIN = 15;
const iso = (ms: number): string => new Date(ms).toISOString();

export interface InteractiveBlockProps {
  id: string;
  dayStartMs: number;
  startMs: number;
  endMs: number;
  topPct: number;
  heightPct: number;
  startLabel: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  onCommit: (patch: { startsAt: string; endsAt: string; pinned: boolean }) => void;
}

type DragMode = 'move' | 'resize';

export function InteractiveBlock(props: InteractiveBlockProps) {
  // `id` is part of the props for the parent's onCommit binding; not read inside this component.
  const { dayStartMs, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit } = props;
  // Refs hold the authoritative drag state; both are mutated directly so pointer handlers always
  // see the latest values regardless of React's batching/commit schedule.
  const modeRef = useRef<DragMode | null>(null);
  const startYRef = useRef<number>(0);
  const offsetPxRef = useRef<number>(0);
  // State is used only to trigger re-renders for the CSS preview.
  const [movePx, setMovePx] = useState(0);
  const [growPx, setGrowPx] = useState(0);
  const locked = pinned;

  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    }
    modeRef.current = mode;
    startYRef.current = e.clientY;
    offsetPxRef.current = 0;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!modeRef.current) return;
    const px = e.clientY - startYRef.current;
    offsetPxRef.current = px;
    if (modeRef.current === 'move') { setMovePx(px); setGrowPx(0); }
    else { setGrowPx(px); setMovePx(0); }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const mode = modeRef.current;
    // Compute offset from the up-event directly in case onPointerMove was not dispatched.
    const offsetPx = startYRef.current !== 0 ? e.clientY - startYRef.current : offsetPxRef.current;
    modeRef.current = null;
    startYRef.current = 0;
    offsetPxRef.current = 0;
    setMovePx(0);
    setGrowPx(0);
    if (!mode) return;
    const deltaMin = snapMinutes(pxToMinutes(offsetPx));
    if (deltaMin === 0) return;
    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;
    if (mode === 'move') {
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      onCommit({ startsAt: iso(dayStartMs + moved.startMin * 60_000), endsAt: iso(dayStartMs + moved.endMin * 60_000), pinned: true });
    } else {
      const newEndMin = Math.min(WINDOW_END_MIN, Math.max(startMin + MIN_DURATION_MIN, endMin + deltaMin));
      if (newEndMin === endMin) return;
      onCommit({ startsAt: iso(startMs), endsAt: iso(dayStartMs + newEndMin * 60_000), pinned: true });
    }
  };

  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`${BASE} cursor-grab select-none ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%`, transform: `translateY(${movePx}px)`, marginBottom: `${-growPx}px` }}
    >
      {locked && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
    </div>
  );
}
