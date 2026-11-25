import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { CalendarBlock } from './CalendarBlock';
import type { BlockKind } from './blockStyle';
import { InteractiveBlock } from './InteractiveBlock';
import { nowLine, isToday, classifyBlock, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign, swipeDecision } from './weekModel';
import { CreatePopover } from './CreatePopover';
import { MS_PER_MIN } from '../lib/time';
import { layoutWeek, blockLeftCss, blockWidthCss } from './blockLayout';
import { DAY_COLUMN_DROP_TYPE, dayColumnDroppableId } from './scheduleDrop';
import { Sheet } from '../components/Sheet';
import { Icons } from '../shell/icons';
import { useToast } from '../shell/ToastProvider';

/**
 * Registers a day column as a dnd-kit droppable without restructuring the grid: hooks cannot run
 * inside the `days.map` loop, and the column has only a `border-l`, so an `inset-0` child has
 * exactly the rect `slotFromEvent` measures. Collision detection is rect maths, never DOM
 * hit-testing, so `pointer-events-none` keeps the column's click-to-create tap completely intact.
 */
function DayDropZone({ dayIndex, dayStartMs }: { dayIndex: number; dayStartMs: number }) {
  const { setNodeRef } = useDroppable({
    id: dayColumnDroppableId(dayIndex),
    data: { type: DAY_COLUMN_DROP_TYPE, dayIndex, dayStartMs },
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

/** One hour row of grid line per 60px, drawn on the day columns (prototype `.col`). */
const GRID_LINES = { backgroundImage: 'repeating-linear-gradient(to bottom, rgb(var(--c-line-rgb) / 0.065) 0 1px, transparent 1px 60px)' };

/** Static key for the block looks (the Meetings / Movable filter toggles arrive in P4). */
function Legend() {
  const item = 'flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] text-fg-2';
  return (
    <div data-testid="grid-legend" className="ml-1 hidden max-h-[22px] min-w-0 flex-wrap items-center gap-x-4 overflow-hidden md:flex">
      <span className={item}><span aria-hidden="true" className="h-3 w-3 rounded-[4px] bg-meeting" /> Meetings</span>
      <span className={item}><span aria-hidden="true" className="h-3 w-3 rounded-[4px] border-[1.5px] border-dashed border-accent-fg" /> Movable</span>
      <span className={item}><Icons.lock size={14} /> Locked</span>
      <span className={item}><span aria-hidden="true" className="block-blocked h-3 w-3 rounded-[4px]" /> Blocked</span>
    </div>
  );
}

export interface WeekGridProps {
  days: number[];            // 1–7 day-column anchors (local midnight, or the `dayStartMinute` wall-clock time)
  nowMs: number;
  weekLabel: string;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onCommit: (id: string, patch: { startsAt?: string; endsAt?: string; pinned?: boolean }) => void;
  /** Drag/resize commit for app-created calendar events (Google-owned events are read-only). */
  onCommitEvent?: (id: string, patch: { startsAt: string; endsAt: string }) => void;
  /** Compact layout only: a tap on an app-created event or blocked time opens the event editor. */
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
  /** Compact layout only: a tap on a task block opens that task's drawer (the detail card is an
   *  md+ feature, spec §5.2). */
  onEditTask?: (taskId: string) => void;
  /** The selected block (`b:<id>` / `e:<id>`), outlined. */
  selectedKey?: string | null;
  /** md+: a click / tap / Enter on a block selects it (the Planner shows its detail card).
   *  `keyboard` = the selection came from the keyboard (focus moves to the card). */
  onSelect?: (key: string, opts: { keyboard: boolean }) => void;
}

interface Item {
  key: string;
  title: string;
  kind: BlockKind;
  source: 'app' | 'google' | null;
  pinned: boolean;
  started: boolean;
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
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, source: null, pinned: cls.pinned,
      started: b.startedAt != null, startMs, endMs: Date.parse(b.endsAt), startLabel: formatHm(startMs, zone),
      blockId: b.id, event: null, taskId: b.taskId };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: e.kind === 'blocked' ? 'blocked' : 'meeting', source: e.source,
      pinned: false, started: false, startMs, endMs: Date.parse(e.endsAt), startLabel: formatHm(startMs, zone),
      blockId: null, event: e, taskId: null };
  });
  // One flat, day-independent order (by key): a cross-day move must not reorder the layer's
  // children, or React re-inserts the node and loses its transition and focus.
  return [...fromEvents, ...fromBlocks].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, onPrev, onToday, onNext, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, taskDrop = null, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false, coarse = false, onEditTask, selectedKey = null, onSelect } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events, zone);
  const layout = layoutWeek(items, days);
  const toast = useToast();

  /**
   * A click (a press that did not drag) or Enter on a block. At md+ it selects (detail card,
   * spec §5.4) — for mouse and touch alike. Below md the side panel is a sheet, so a tap keeps the
   * old behaviour and opens the drawer directly; the two kinds with no drawer say why.
   */
  const activate = (it: Item, keyboard: boolean) => {
    if (!compact) { onSelect?.(it.key, { keyboard }); return; }
    if (it.blockId) {
      if (it.taskId) onEditTask?.(it.taskId);
      else toast.show('Edit habits on the Habits page');
      return;
    }
    if (it.event?.source === 'app') onEditEvent?.(it.event);
    else toast.show('Synced from Google Calendar', { icon: 'lock' });
  };
  const n = days.length;
  const todayIndex = days.findIndex((d) => isToday(nowMs, d));
  const todayLine = todayIndex >= 0 ? nowLine(nowMs, days[todayIndex]!) : null;
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
  // `topPct` is ignored on the compact path (the sheet is viewport-anchored); the day anchor is
  // not — it is what the created entry's timestamps are built from.
  const creatingDayMs = creating ? days[creating.dayIndex] : undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  // Where a day-header drag started. The header sits OUTSIDE hours-scroll, so a swipe here can
  // never fight the vertical hour scrolling; the ratio guard in swipeDecision covers diagonals.
  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  // On mount, scroll so the current time-of-day sits near the top (a little context above).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minOfDay = Math.max(0, Math.min(WINDOW_END_MIN, (nowMs - dayAnchor(nowMs, zone, dayStartMinute)) / MS_PER_MIN));
    el.scrollTop = Math.max(0, (minOfDay / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX - 64);
    // Empty deps on purpose: scroll to "now" once on mount.
  }, []);

  const slotFromEvent = (e: { currentTarget: HTMLElement; clientY: number }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return snapClickToSlot(fraction);
  };

  /** Horizontal frame of day column `i` inside the block layer (popover / drop-indicator slots). */
  const colFrame = (i: number) => ({ left: `${(i / n) * 100}%`, width: `${100 / n}%` });
  const navBtn = 'btn-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full';

  return (
    <div className={`glass flex min-h-0 flex-1 flex-col rounded-panel ${compact ? 'p-2' : 'p-5'}`}>
      {/* Wraps to two rows on a phone by design; `md:flex-nowrap` keeps the desktop toolbar on one
          row. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 md:mb-4 md:flex-nowrap md:gap-3">
        <div className="flex gap-2">
          <button onClick={onPrev} aria-label="Previous" title="Previous days" className={navBtn}><Icons.chevLeft size={18} /></button>
          <button onClick={onNext} aria-label="Next" title="Next days" className={navBtn}><Icons.chevRight size={18} /></button>
        </div>
        {/* Compact keeps `min-w-0 truncate` (its row can wrap and the label may be long); on md the
            row cannot wrap, and without `md:shrink-0` the truncation happily eats the range label
            down to zero width — measured: label invisible at a 626px pane. The legend gives instead. */}
        <span className={`min-w-0 truncate font-medium tracking-[-0.01em] text-fg md:shrink-0 ${compact ? 'text-[16px]' : 'text-[20px]'}`}>{weekLabel}</span>
        <button onClick={onToday} className="btn-glass h-9 shrink-0 rounded-pill px-4 text-[14px] text-fg">Today</button>
        <span className="flex-1" />
        {/* The legend is dropped below md (spec §4). It is the one element that gives when the row
            cannot wrap: `min-w-0` lets it shrink, and wrapping inside a one-line-tall clip drops
            whole chips off the end rather than splitting a chip across two lines. */}
        <Legend />
        {onTogglePanel && (compact ? (
          <button
            type="button"
            data-testid="panel-sheet-toggle"
            aria-expanded={!panelHidden}
            onClick={onTogglePanel}
            className="btn-glass h-11 shrink-0 rounded-pill px-4 text-[14px] font-medium"
          >
            Tasks
          </button>
        ) : (
          <button
            type="button"
            data-testid={panelHidden ? 'panel-show' : 'panel-hide'}
            aria-label={panelHidden ? 'Show tasks panel' : 'Hide tasks panel'}
            onClick={onTogglePanel}
            className="btn-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-2 hover:text-fg"
          >
            <Icons.panelRight size={20} />
          </button>
        ))}
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* header grid */}
          <div
            data-testid="day-header-row"
            className="grid shrink-0"
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
                  className={`flex flex-col items-center text-center ${compact ? 'gap-1 pb-2' : 'gap-1.5 pb-3'}`}
                >
                  <div className="text-[12px] uppercase tracking-[0.1em] text-fg-2">{weekdayLabel(d, zone)}</div>
                  <div
                    className={`flex items-center justify-center rounded-full font-medium ${compact ? 'h-8 w-8 text-[16px]' : 'h-10 w-10 text-[20px]'} ${today ? 'bg-today text-on-today shadow-[0_8px_22px_-8px_rgb(var(--c-today)/0.9)]' : 'text-fg'}`}
                  >
                    {date}
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
              ancestor); the overflow then lands in AppShell's `shell-content` scroller instead of
              the grid collapsing. `overscroll-contain` keeps a rubber-band flick at the top or
              bottom of the hours from scrolling the page behind it — a phone concern, so `md+`
              restores native scroll chaining. */}
          <div ref={scrollRef} data-testid="hours-scroll" className="min-h-[240px] flex-1 overflow-y-auto overscroll-contain md:overscroll-auto">
          <div className="grid" style={{ gridTemplateColumns: `${timeGutterPx(compact)}px minmax(0, 1fr)` }}>
            <div data-testid="hour-gutter">
              {HOURS.map((h) => (
                <div key={h} className="relative h-[60px]">
                  <span className={`absolute -top-[8px] whitespace-nowrap text-fg-3 ${compact ? 'right-[6px] text-[10px]' : 'right-[10px] text-[12px]'}`}>{hourRowLabel(h, dayStartMinute)}</span>
                </div>
              ))}
            </div>
            {/* Days area: the day columns (click-to-create, dnd-kit drop zones, tints) and ONE block
                layer over all of them. The layer is pointer-events-none and each block opts back in,
                so a click on an empty slot falls through to its column. */}
            <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {days.map((d, i) => (
                <div key={d} data-testid={`day-col-${i}`}
                  data-drop-target={taskDrop?.dayIndex === i ? 'true' : undefined}
                  data-today={i === todayIndex ? 'true' : undefined}
                  className={`relative border-l border-grid ${i === todayIndex ? 'bg-today-col' : ''} ${taskDrop?.dayIndex === i ? 'bg-accent/[.06]' : ''}`}
                  style={GRID_LINES}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-testid="event-block"],[data-testid="create-popover"]')) return;
                    setCreating({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                >
                  <DayDropZone dayIndex={i} dayStartMs={d} />
                </div>
              ))}

              <div data-testid="block-layer" className="pointer-events-none absolute inset-0">
                {items.map((it) => {
                  const g = layout.get(it.key);
                  if (!g) return null;
                  const d = days[g.dayIndex]!;
                  const blockId = it.blockId;
                  const accent = it.taskId ? accents[it.taskId] : undefined;
                  const geometry = { topPct: g.topPct, heightPct: g.heightPct, leftPct: g.leftPct, widthPct: g.widthPct, lane: g.lane, lanes: g.lanes };
                  if (it.kind !== 'meeting' && it.kind !== 'blocked' && blockId) {
                    return (
                      <InteractiveBlock
                        key={it.key} dayStartMs={d} dayIndex={g.dayIndex}
                        startMs={it.startMs} endMs={it.endMs}
                        {...geometry}
                        startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={it.pinned} started={it.started}
                        onCommit={(patch) => onCommit(blockId, patch)}
                        onUnpin={it.pinned ? () => onCommit(blockId, { pinned: false }) : undefined}
                        onDelete={onDeleteBlock ? () => onDeleteBlock(blockId) : undefined}
                        onClick={(keyboard) => activate(it, keyboard)}
                        blockKey={it.key}
                        selected={selectedKey === it.key}
                        dayCount={n}
                        accent={accent}
                        zone={zone}
                        coarse={coarse}
                        getScrollContainer={() => scrollRef.current}
                      />
                    );
                  }
                  // App-created events are ours to move: same drag/resize machinery as task
                  // blocks, minus pinning. Google-owned events mirror the remote calendar and
                  // stay static (locked).
                  const ev = it.event;
                  if (ev && ev.source === 'app') {
                    return (
                      <InteractiveBlock
                        key={it.key} dayStartMs={d} dayIndex={g.dayIndex}
                        startMs={it.startMs} endMs={it.endMs}
                        {...geometry}
                        startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={false} source="app"
                        onCommit={(patch) => onCommitEvent?.(ev.id, { startsAt: patch.startsAt, endsAt: patch.endsAt })}
                        onClick={(keyboard) => activate(it, keyboard)}
                        blockKey={it.key}
                        selected={selectedKey === it.key}
                        onDelete={onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}
                        deleteLabel="Delete event"
                        dayCount={n}
                        zone={zone}
                        coarse={coarse}
                        getScrollContainer={() => scrollRef.current}
                      />
                    );
                  }
                  return (
                    <CalendarBlock
                      key={it.key}
                      blockKey={it.key}
                      selected={selectedKey === it.key}
                      onBodyClick={(e) => activate(it, e.detail === 0)}
                      title={it.title}
                      kind={it.kind}
                      source={it.source}
                      pinned={it.pinned}
                      accent={accent}
                      startLabel={it.startLabel}
                      whenLabel={`${weekdayLabel(it.startMs, zone)} ${formatHm(it.startMs, zone)} – ${formatHm(it.endMs, zone)}`}
                      durationMin={(it.endMs - it.startMs) / MS_PER_MIN}
                      dayIndex={g.dayIndex}
                      coarse={coarse}
                      onDelete={ev && onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}
                      deleteLabel="Delete event"
                      className="transition-[top,left,height] duration-300 ease-out"
                      style={{ top: `${g.topPct}%`, height: `${g.heightPct}%`, left: blockLeftCss(g.leftPct, g.lane, g.lanes), width: blockWidthCss(g.widthPct, g.lane, g.lanes) }}
                    />
                  );
                })}

                {todayLine != null && (
                  <div
                    data-testid="now-line"
                    data-day-index={todayIndex}
                    aria-hidden="true"
                    className="absolute z-[4] h-0.5 -translate-y-1/2 bg-now"
                    style={{ top: `${todayLine}%`, ...colFrame(todayIndex) }}
                  >
                    <span className="absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-now animate-pulse-dot" />
                  </div>
                )}

                {/* Column slots for what must draw ABOVE the blocks: the drag-from-panel drop
                    indicator and the create popover. Hoisted out of the day columns into the layer,
                    because a column painted above the layer would also swallow the blocks' clicks. */}
                {days.map((d, i) => {
                  const showDrop = taskDrop?.dayIndex === i;
                  const showPopover = creating?.dayIndex === i && !compact;
                  if (!showDrop && !showPopover) return null;
                  return (
                    <div key={d} data-testid={`col-slot-${i}`} className="pointer-events-none absolute inset-y-0 z-30" style={colFrame(i)}>
                      {showDrop && (
                        <div
                          data-testid="task-drop-indicator"
                          className="absolute left-1 right-1 h-1 rounded-full bg-accent shadow-accent"
                          style={{ top: `${((taskDrop.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}%` }}
                        />
                      )}
                      {showPopover && (
                        <CreatePopover
                          dayStartMs={d}
                          startMin={creating.startMin}
                          topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                          onClose={() => setCreating(null)}
                          align={popoverAlign(i, n)}
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
      </div>

      {/* Compact: the create form is a viewport sheet, hoisted OUT of the day column on purpose.
          React events follow the DOM tree, so a backdrop rendered inside the column would bubble
          its dismissing click into the column's click-to-create handler and re-open the form at
          another slot — the "I can't close it" report. `days[dayIndex]` is re-read here because
          a resize can shrink `days` while the form is open. */}
      {compact && creating && creatingDayMs !== undefined && (
        <Sheet label="New entry" onClose={() => setCreating(null)} scrollBody>
          <CreatePopover
            dayStartMs={creatingDayMs}
            startMin={creating.startMin}
            topPct={0}
            onClose={() => setCreating(null)}
            zone={zone}
            compact
          />
        </Sheet>
      )}
    </div>
  );
}
