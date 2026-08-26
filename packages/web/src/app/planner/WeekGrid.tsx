import { useEffect, useRef, useState } from 'react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { InteractiveBlock } from './InteractiveBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign } from './weekModel';
import { CreatePopover } from './CreatePopover';
import { layoutOverlaps } from './overlapLayout';
import { Icons } from '../shell/icons';

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
  onScheduleTaskAt?: (taskId: string, dayStartMs: number, startMin: number) => void;
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
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, onScheduleTaskAt, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false, coarse = false } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events, zone);
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
  // Live drop indicator while dragging a task card from the side panel over the grid.
  const [taskDrop, setTaskDrop] = useState<{ dayIndex: number; startMin: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // On mount, scroll so the current time-of-day sits near the top (a little context above).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minOfDay = Math.max(0, Math.min(WINDOW_END_MIN, (nowMs - dayAnchor(nowMs, zone, dayStartMinute)) / 60_000));
    el.scrollTop = Math.max(0, (minOfDay / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX - 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll to "now" once on mount
  }, []);

  // Always clear the drop indicator when any drag ends — covers ESC-cancel and drops that
  // land off the grid, where no column `dragleave`/`drop` fires (dragend fires on the source).
  useEffect(() => {
    const clear = () => setTaskDrop(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  const slotFromEvent = (e: { currentTarget: HTMLElement; clientY: number }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return snapClickToSlot(fraction);
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2 md:mb-4 md:gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>‹</button>
          <button onClick={onNext} aria-label="Next" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>›</button>
        </div>
        <span className={`min-w-0 truncate font-bold text-ink ${compact ? 'text-[15px]' : 'text-[18px]'}`}>{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        {/* The legend needs ~700px of toolbar; below md it is dropped entirely (spec §4). */}
        <div data-testid="grid-legend" className="ml-2 hidden items-center gap-3 md:flex">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[14px] font-semibold text-inkSoft">
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

      <div className="w-full">
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          {/* header grid */}
          <div data-testid="day-header-row" className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
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
          {/* Height must be right under BOTH chromes. Desktop: 70px TopBar + p-4 + toolbar +
              day header ≈ 230px (byte-identical to the value this used to carry inline).
              Compact: 56px mobile top bar + 56px fixed tab bar + p-2 + toolbar + day header
              ≈ 260px, plus the home-indicator inset. Tailwind turns `_` into a space. */}
          <div ref={scrollRef} data-testid="hours-scroll" className="max-h-[calc(100dvh_-_260px_-_env(safe-area-inset-bottom))] overflow-y-auto md:max-h-[calc(100dvh_-_230px)]">
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
                  onDragOver={(e) => {
                    // Only react to task cards dragged from the side panel.
                    if (!onScheduleTaskAt || !e.dataTransfer.types.includes('application/x-nr-task')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setTaskDrop({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                  onDragLeave={(e) => {
                    // Ignore leaves into child elements of the same column.
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setTaskDrop((p) => (p?.dayIndex === i ? null : p));
                  }}
                  onDrop={(e) => {
                    if (!onScheduleTaskAt) return;
                    const taskId = e.dataTransfer.getData('application/x-nr-task') || e.dataTransfer.getData('text/plain');
                    setTaskDrop(null);
                    if (!taskId) return;
                    e.preventDefault();
                    onScheduleTaskAt(taskId, d, slotFromEvent(e));
                  }}
                >
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
