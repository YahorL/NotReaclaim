import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta } from './weekModel';

const MIN_DURATION_MIN = 15;
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
}

type DragMode = 'move' | 'resize';

export function InteractiveBlock(props: InteractiveBlockProps) {
  // `id` is part of the props for the parent's onCommit binding; not read inside this component.
  const { dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit } = props;
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

  const reset = () => {
    modeRef.current = null;
    startYRef.current = 0;
    startXRef.current = 0;
    colWidthRef.current = 0;
    setMoveMin(0);
    setGrowMin(0);
    setDayDelta(0);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const deltaMin = snappedDy(e.clientY);
    const deltaDays = modeRef.current === 'move' ? snappedDx(e.clientX) : 0;
    const mode = modeRef.current;
    reset();
    if (!mode) return;
    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;
    if (mode === 'move') {
      if (deltaMin === 0 && deltaDays === 0) return;
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      const dayStart = shiftDays(dayStartMs, deltaDays);
      onCommit({ startsAt: iso(dayStart + moved.startMin * 60_000), endsAt: iso(dayStart + moved.endMin * 60_000), pinned: true });
    } else {
      const newEndMin = Math.min(WINDOW_END_MIN, Math.max(startMin + MIN_DURATION_MIN, endMin + deltaMin));
      if (newEndMin === endMin) return;
      onCommit({ startsAt: iso(startMs), endsAt: iso(dayStartMs + newEndMin * 60_000), pinned: true });
    }
  };

  const onPointerCancel = () => { reset(); };

  const dragging = moveMin !== 0 || growMin !== 0 || dayDelta !== 0;
  const previewStart = startMs + moveMin * 60_000;
  const previewEnd = growMin !== 0 ? endMs + growMin * 60_000 : endMs + moveMin * 60_000;

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
      className={`${BASE} ${dragging ? 'cursor-grabbing' : 'cursor-grab'} select-none ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${minutesToPx(growMin)}px)`, transform: `translate(${dayDelta * colWidthRef.current}px, ${minutesToPx(moveMin)}px)` }}
    >
      {pinned && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
      {dragging && (
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
