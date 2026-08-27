import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { InteractiveBlock } from './InteractiveBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign, swipeDecision } from './weekModel';
import { CreatePopover } from './CreatePopover';
import { layoutOverlaps } from './overlapLayout';
import { Icons } from '../shell/icons';

/**
 * Registers a day column as a dnd-kit droppable without restructuring the grid: hooks cannot run
 * inside the `days.map` loop, and the column has only a `border-l`, so an `inset-0` child has
 * exactly the rect the old `slotFromEvent` measured. Collision detection is rect maths, never DOM
 * hit-testing, so `pointer-events-none` keeps the column's click-to-create tap completely intact.
 */
function DayDropZone({ dayIndex, dayStartMs }: { dayIndex: number; dayStartMs: number }) {
  const { setNodeRef } = useDroppable({
    id: `day-col:${dayIndex}`,
    data: { type: 'day-col', dayIndex, dayStartMs },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`day-drop-${dayIndex}`}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    />
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 24 hour rows, counted from the day start

const LEGEND: { label: string; swatch: string }[] = [
  { label: 'Meeting', swatch: 'bg-event' },
  { label: 'Locked 🔒', swatch: 'bg-low' },
  { label: 'Movable', swatch: 'border border-dashed border-low' },
  { label: 'Blocked', swatch: 'border border-slate-300 bg-slate-100' },
];

export interface WeekGridProps {
  days: number[];            // 7 local-midnight timestamps
  nowMs: number;
  weekLabel: string;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  replanPending: boolean;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onReplan: () => void;
  onCommit: (id: string, patch: { startsAt?: string; endsAt?: string; pinned?: boolean }) => void;
  /** Drag/resize commit for app-created calendar events (Google-owned events are read-only). */
  onCommitEvent?: (id: string, patch: { startsAt: string; endsAt: string }) => void;
  /** Click (no drag) on an app-created event — opens the event editor. */
  onEditEvent?: (event: CalendarEvent) => void;
  onDeleteBlock?: (id: string) => void;
  onDeleteEvent?: (id: string) => void;
  /** Live drop target while a task card is dragged over the grid (owned by Planner's DndContext). */
  taskDrop?: { dayIndex: number; startMin: number } | null;
  accents?: Record<string, string>;
  zone?: string;
  /** Minutes past local midnight that a day column starts at (0 = midnight). Labels/scroll only —
   *  the column anchors themselves arrive in `days`. */
  dayStartMinute?: number;
  panelHidden?: boolean;
  onTogglePanel?: () => void;
  /** Below-md layout: narrow gutter, wrapped toolbar, Tasks sheet button, no legend. */
  compact?: boolean;
  /** Coarse pointer: long-press-armed drag, bigger resize target, always-visible actions. */
  coarse?: boolean;
}

interface Item {
  key: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  startMs: number;
  endMs: number;
  startLabel: string;
  blockId: string | null;
  event: CalendarEvent | null;
  taskId: string | null;
}

function toItems(blocks: ScheduledBlock[], events: CalendarEvent[], zone: string): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned,
      startMs, endMs: Date.parse(b.endsAt), startLabel: formatHm(startMs, zone), blockId: b.id,
      event: null, taskId: b.taskId };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: e.kind === 'blocked' ? 'blocked' : 'meeting', pinned: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: formatHm(startMs, zone), blockId: null, event: e, taskId: null };
  });
  return [...fromEvents, ...fromBlocks];
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, taskDrop = null, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false, coarse = false } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events, zone);
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Where a day-header drag started. The header sits OUTSIDE hours-scroll, so a swipe here can
  // never fight the vertical hour scrolling; the ratio guard in swipeDecision covers diagonals.
  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  // On mount, scroll so the current time-of-day sits near the top (a little context above).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minOfDay = Math.max(0, Math.min(WINDOW_END_MIN, (nowMs - dayAnchor(nowMs, zone, dayStartMinute)) / 60_000));
    el.scrollTop = Math.max(0, (minOfDay / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX - 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll to "now" once on mount
  }, []);

  const slotFromEvent = (e: { currentTarget: HTMLElement; clientY: number }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return snapClickToSlot(fraction);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Wraps to two rows on a phone by design; `md:flex-nowrap` keeps the desktop toolbar on the
          single ~38px row it had before the compact styles landed. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 md:mb-4 md:flex-nowrap md:gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>‹</button>
          <button onClick={onNext} aria-label="Next" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>›</button>
        </div>
        {/* Compact keeps `min-w-0 truncate` (its row can wrap and the label may be long); on md the
            row cannot wrap, and without `md:shrink-0` the truncation happily eats the range label
            down to zero width — measured: label invisible at a 626px pane. The legend gives instead. */}
        <span className={`min-w-0 truncate font-bold text-ink md:shrink-0 ${compact ? 'text-[15px]' : 'text-[18px]'}`}>{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        {/* `shrink-0 whitespace-nowrap`: with the row no longer wrapping on md, a narrow grid pane
            (626px at 1280 with the task panel open) otherwise squeezes this button to 53px and
            wraps "↻ Re-plan" onto three lines. The legend is the one element allowed to give. */}
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="shrink-0 whitespace-nowrap rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        {/* The legend needs ~700px of toolbar; below md it is dropped entirely (spec §4). It is the
            one element that gives when the row cannot wrap: the grid pane is only 626px at 1280
            with the task panel open, ~200px short of the full toolbar. `min-w-0` lets it shrink,
            and wrapping inside a one-line-tall clip drops whole chips off the end rather than
            splitting a chip across two lines (which is what pushed the toolbar to 42px). */}
        <div data-testid="grid-legend" className="ml-2 hidden max-h-[22px] min-w-0 flex-wrap items-center gap-3 overflow-hidden md:flex">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-inkSoft">
              <span className={`h-[11px] w-[11px] rounded-[3px] ${l.swatch}`} /> {l.label}
            </span>
          ))}
        </div>
        {onTogglePanel && (compact ? (
          <button
            type="button"
            data-testid="panel-sheet-toggle"
            aria-expanded={!panelHidden}
            onClick={onTogglePanel}
            className="shrink-0 rounded-[9px] border border-line bg-card px-3 py-2 text-[14px] font-bold text-ink"
          >
            Tasks
          </button>
        ) : (
          <button
            type="button"
            data-testid={panelHidden ? 'panel-show' : 'panel-hide'}
            aria-label={panelHidden ? 'Show tasks panel' : 'Hide tasks panel'}
            onClick={onTogglePanel}
            className="ml-1 shrink-0 rounded-[9px] p-2 text-inkSoft hover:bg-line hover:text-ink"
          >
            <Icons.panelRight size={20} />
          </button>
        ))}
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-card">
          {/* header grid */}
          <div
            data-testid="day-header-row"
            className="grid shrink-0 border-b border-line"
            style={{ gridTemplateColumns: gridCols }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              swipeOriginRef.current = t ? { x: t.clientX, y: t.clientY } : null;
            }}
            onTouchEnd={(e) => {
              const origin = swipeOriginRef.current;
              swipeOriginRef.current = null;
              const t = e.changedTouches[0];
              if (!origin || !t) return;
              const pages = swipeDecision(t.clientX - origin.x, t.clientY - origin.y);
              if (pages === 1) onNext();
              else if (pages === -1) onPrev();
            }}
          >
            <div />
            {days.map((d, i) => {
              const today = isToday(nowMs, d);
              const date = dayOfMonth(d, zone);
              return (
                <div
                  key={d}
                  data-testid={`day-header-${i}`}
                  data-today={today}
                  className={`border-l border-line text-center ${compact ? 'py-2' : 'py-3'}`}
                >
                  <div className={`font-bold uppercase tracking-wide text-inkSoft ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{weekdayLabel(d, zone)}</div>
                  <div className={`mt-0.5 font-extrabold ${compact ? 'text-[18px]' : 'text-[21px]'}`}>
                    {today
                      ? <span className="rounded-[9px] bg-indigo px-[9px] py-[1px] text-white">{date}</span>
                      : <span className="text-ink">{date}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* body grid (scrolls vertically; the day header above stays pinned) */}
          {/* The height comes from the flex chain (Planner h-full → grid pane → this card), NOT
              from a chrome constant: toolbars wrap, banners appear and the mobile top bar differs,
              so any `100dvh - Npx` guess is wrong on some viewport. shell-content's padding already
              reserves the fixed tab bar. `min-h-[240px]` floors degenerate cases (a zero-height
              ancestor) so the grid falls back to the outer scroll instead of collapsing. */}
          <div ref={scrollRef} data-testid="hours-scroll" className="min-h-[240px] flex-1 overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
            <div data-testid="hour-gutter">
              {HOURS.map((h) => (
                <div key={h} className="relative h-[58px]">
                  <span className={`absolute -top-[8px] font-semibold text-[#a6aab8] ${compact ? 'right-[6px] text-[10px]' : 'right-[10px] text-[12px]'}`}>{hourRowLabel(h, dayStartMinute)}</span>
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
              const lanes = layoutOverlaps(dayItems.map((it) => ({ key: it.key, startMs: it.startMs, endMs: it.endMs })));
              const line = nowLine(nowMs, d);
              return (
                <div key={d} data-testid={`day-col-${i}`}
                  className={`relative border-l border-line ${taskDrop?.dayIndex === i ? 'bg-indigoSoft/60' : ''}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-testid="event-block"],[data-testid="create-popover"]')) return;
                    setCreating({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                >
                  <DayDropZone dayIndex={i} dayStartMs={d} />
                  {HOURS.map((h) => <div key={h} className="h-[58px] border-t border-[#f1f2f6]" />)}
                  {dayItems.map((it) => {
                    const pos = placeInDay(it.startMs, it.endMs, d);
                    if (!pos) return null;
                    const blockId = it.blockId;
                    // Resolve accent: task blocks with a taskId that has a colored category
                    const accent = it.taskId ? accents[it.taskId] : undefined;
                    const ln = lanes.get(it.key) ?? { lane: 0, lanes: 1 };
                    const leftPct = (ln.lane / ln.lanes) * 100;
                    const widthPct = (1 / ln.lanes) * 100;
                    if (it.kind !== 'meeting' && blockId) {
                      return (
                        <InteractiveBlock
                          key={it.key} id={blockId} dayStartMs={d} dayIndex={i}
                          startMs={it.startMs} endMs={it.endMs}
                          topPct={pos.topPct} heightPct={pos.heightPct}
                          leftPct={leftPct} widthPct={widthPct}
                          startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={it.pinned}
                          onCommit={(patch) => onCommit(blockId, patch)}
                          onUnpin={it.pinned ? () => onCommit(blockId, { pinned: false }) : undefined}
                          onDelete={onDeleteBlock ? () => onDeleteBlock(blockId) : undefined}
                          dayCount={days.length}
                          accent={accent}
                          zone={zone}
                          coarse={coarse}
                          getScrollContainer={() => scrollRef.current}
                        />
                      );
                    }
                    // App-created events are ours to move: same drag/resize machinery as task
                    // blocks, minus pinning. Google-owned events mirror the remote calendar and
                    // stay static.
                    const ev = it.event;
                    if (ev && ev.source === 'app') {
                      return (
                        <InteractiveBlock
                          key={it.key} id={ev.id} dayStartMs={d} dayIndex={i}
                          startMs={it.startMs} endMs={it.endMs}
                          topPct={pos.topPct} heightPct={pos.heightPct}
                          leftPct={leftPct} widthPct={widthPct}
                          startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={false}
                          onCommit={(patch) => onCommitEvent?.(ev.id, { startsAt: patch.startsAt, endsAt: patch.endsAt })}
                          onClick={onEditEvent ? () => onEditEvent(ev) : undefined}
                          onDelete={onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}
                          deleteLabel="Delete event"
                          dayCount={days.length}
                          zone={zone}
                          coarse={coarse}
                          getScrollContainer={() => scrollRef.current}
                        />
                      );
                    }
                    return (
                      <EventBlock
                        key={it.key}
                        title={it.title}
                        kind={it.kind}
                        pinned={it.pinned}
                        topPct={pos.topPct}
                        heightPct={pos.heightPct}
                        leftPct={leftPct}
                        widthPct={widthPct}
                        startLabel={it.startLabel}
                        accent={accent}
                        onDelete={ev && onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}
                        coarse={coarse}
                      />
                    );
                  })}
                  {line != null && (
                    <div data-testid="now-line" className="absolute left-0 right-0 h-0.5 bg-crit" style={{ top: `${line}%` }} />
                  )}
                  {taskDrop?.dayIndex === i && (
                    <div
                      data-testid="task-drop-indicator"
                      className="pointer-events-none absolute left-0.5 right-0.5 z-10 h-1 rounded bg-indigo"
                      style={{ top: `${((taskDrop.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}%` }}
                    />
                  )}
                  {creating?.dayIndex === i && (
                    <CreatePopover
                      dayStartMs={d}
                      startMin={creating.startMin}
                      topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                      onClose={() => setCreating(null)}
                      align={popoverAlign(i, days.length)}
                      zone={zone}
                      compact={compact}
                    />
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
