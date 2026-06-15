import { useEffect, useState } from 'react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { InteractiveBlock } from './InteractiveBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, TIME_GUTTER_PX } from './weekModel';
import { CreatePopover } from './CreatePopover';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 06:00 → 21:00 row starts (06:00–22:00 window)

const LEGEND: { label: string; swatch: string }[] = [
  { label: 'Meeting', swatch: 'bg-event' },
  { label: 'Locked 🔒', swatch: 'bg-low' },
  { label: 'Movable', swatch: 'border border-dashed border-low' },
];

function hourLabel(h: number): string {
  const period = h < 12 ? 'a' : 'p';
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${period}`;
}

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
  onDeleteBlock?: (id: string) => void;
  onDeleteEvent?: (id: string) => void;
  onScheduleTaskAt?: (taskId: string, dayStartMs: number, startMin: number) => void;
  accents?: Record<string, string>;
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
  eventId: string | null;
  taskId: string | null;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toItems(blocks: ScheduledBlock[], events: CalendarEvent[]): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned,
      startMs, endMs: Date.parse(b.endsAt), startLabel: timeLabel(startMs), blockId: b.id,
      eventId: null, taskId: b.taskId };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: 'meeting', pinned: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: timeLabel(startMs), blockId: null, eventId: e.id, taskId: null };
  });
  return [...fromEvents, ...fromBlocks];
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onDeleteBlock, onDeleteEvent, onScheduleTaskAt, accents = {} } = props;
  const gridCols = `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events);
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
  // Live drop indicator while dragging a task card from the side panel over the grid.
  const [taskDrop, setTaskDrop] = useState<{ dayIndex: number; startMin: number } | null>(null);

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
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous week" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">‹</button>
          <button onClick={onNext} aria-label="Next week" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">›</button>
        </div>
        <span className="text-[18px] font-bold text-ink">{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        <div className="ml-2 flex items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[14px] font-semibold text-inkSoft">
              <span className={`h-[11px] w-[11px] rounded-[3px] ${l.swatch}`} /> {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="w-full">
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          {/* header grid */}
          <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
            <div />
            {days.map((d, i) => {
              const today = isToday(nowMs, d);
              const date = new Date(d).getDate();
              return (
                <div
                  key={d}
                  data-testid={`day-header-${i}`}
                  data-today={today}
                  className="border-l border-line py-3 text-center"
                >
                  <div className="text-[13px] font-bold uppercase tracking-wide text-inkSoft">{DAY_LABELS[i]}</div>
                  <div className="mt-0.5 text-[21px] font-extrabold">
                    {today
                      ? <span className="rounded-[9px] bg-indigo px-[9px] py-[1px] text-white">{date}</span>
                      : <span className="text-ink">{date}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* body grid */}
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
            <div>
              {HOURS.map((h) => (
                <div key={h} className="relative h-[58px]">
                  <span className="absolute right-[10px] -top-[8px] text-[12px] font-semibold text-[#a6aab8]">{hourLabel(h)}</span>
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
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
                    if (it.kind !== 'meeting' && blockId) {
                      return (
                        <InteractiveBlock
                          key={it.key} id={blockId} dayStartMs={d} dayIndex={i}
                          startMs={it.startMs} endMs={it.endMs}
                          topPct={pos.topPct} heightPct={pos.heightPct}
                          startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={it.pinned}
                          onCommit={(patch) => onCommit(blockId, patch)}
                          onUnpin={it.pinned ? () => onCommit(blockId, { pinned: false }) : undefined}
                          onDelete={onDeleteBlock ? () => onDeleteBlock(blockId) : undefined}
                          dayCount={days.length}
                          accent={accent}
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
                        startLabel={it.startLabel}
                        accent={accent}
                        onDelete={it.eventId && onDeleteEvent ? () => onDeleteEvent(it.eventId!) : undefined}
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
                      align={i <= 3 ? 'left' : 'right'}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
