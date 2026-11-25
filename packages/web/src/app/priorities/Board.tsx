import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, MeasuringStrategy, defaultDropAnimationSideEffects,
  type DragEndEvent, type DragOverEvent, type DragStartEvent, type DropAnimation, type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { usePrefersReducedMotion } from '../../theme/usePrefersReducedMotion';
import { Icons } from '../shell/icons';
import { formatDurationShort } from '../lib/duration';
import { type BoardColumnKey, dueShort } from './priorityBucket';
import { makeAnnouncements } from '../dnd/announcements';
import { usePointerSensors, pointerFirstCollision } from '../dnd/sensors';
import {
  COLUMN_DROPPABLE_PREFIX, applyBoardDrop, boardDropTargetName, dropPosition, keyboardMove, moveAnnouncement,
  overColumnKey, resolveBoardDrop, type BoardArrowKey, type BoardDrop,
} from './boardDnd';
import { Column } from './Column';
import { GripDots } from './TaskRow';

export interface BoardColumn { key: BoardColumnKey; tasks: Task[]; }

export interface BoardProps {
  columns: BoardColumn[];
  now: number;
  /** Settings zone the cards' date labels are read in. */
  zone: string;
  nextMsFor: (taskId: string) => number | null;
  onMove: (taskId: string, to: BoardColumnKey, index: number) => void;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
  /**
   * Fires `true` when a drag starts and `false` when it ends or is cancelled. The pane above the
   * board has to drop CSS scroll-snapping for the duration — see `boardPane.ts`.
   */
  onDragActiveChange?: (active: boolean) => void;
  /** A search is narrowing the board: empty columns say "No matching tasks". */
  filtered?: boolean;
}

/** Where a pointer drag would land in a column other than its own: before a card, or at the end. */
interface Insertion { column: BoardColumnKey; beforeId: string | null }

/**
 * The arrangement shown from a move until the task query catches up. Keyed on the `columns` it was
 * derived from: once the parent passes new columns (optimistic write or refetch) it is ignored.
 * `flip: false` for a same-column pointer drop, whose cards dnd-kit already slid into place.
 */
interface Held { base: BoardColumn[]; columns: BoardColumn[]; flip: boolean }

// Prototype `--ease-spring-strong`, as a literal: WAAPI / dnd-kit take an easing string, not a var().
const LAND_EASING = 'cubic-bezier(.34,1.4,.5,1)';
const LAND_MS = 520;
const TILT = 'rotate(-1.5deg) scale(1.03)';

const DROP_ANIMATION: DropAnimation = {
  duration: LAND_MS,
  easing: LAND_EASING,
  sideEffects: (args) => {
    // The source slot stays hidden while the clone flies into it; the clone straightens on the way.
    const restore = defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })(args);
    const card = args.dragOverlay.node.querySelector<HTMLElement>('[data-tilt]');
    card?.animate?.([{ transform: TILT }, { transform: 'none' }], { duration: LAND_MS, easing: LAND_EASING, fill: 'forwards' });
    return restore;
  },
};

// No KeyboardSensor on the board: keyboard moves are direct (grip + arrows, see `keyboardMove`),
// so dnd-kit's stock "press space to pick up" text would be wrong.
const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Up and down arrows reorder this task. Left and right arrows move it to the neighbouring column. With a mouse or touch, drag it by the grip.',
};

function emptyTextFor(key: BoardColumnKey, filtered: boolean): string {
  if (filtered) return 'No matching tasks';
  return key === 'completed' ? 'No completed tasks' : 'Drop tasks here';
}

export function Board({
  columns, now, zone, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask, onDragActiveChange, filtered = false,
}: BoardProps) {
  const sensors = usePointerSensors();
  const reducedMotion = usePrefersReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardColumnKey | null>(null);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Lifted out of Column so a drop (or a keyboard move) into a collapsed column can expand it.
  const [collapsed, setCollapsed] = useState<ReadonlySet<BoardColumnKey>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const refocusId = useRef<string | null>(null);

  const shown = held !== null && held.base === columns ? held.columns : columns;
  const suppressFlip = held !== null && held.base === columns && !held.flip;
  const tasksById = useMemo(() => new Map(shown.flatMap((c) => c.tasks).map((t) => [t.id, t])), [shown]);
  const activeTask = activeId !== null ? tasksById.get(activeId) ?? null : null;

  const toggleCollapsed = (key: BoardColumnKey) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /** Show the move at once, open the target if it was collapsed, and persist it. */
  const commit = (drop: BoardDrop, flip: boolean) => {
    setHeld({ base: columns, columns: applyBoardDrop(shown, drop), flip });
    if (collapsed.has(drop.to)) toggleCollapsed(drop.to);
    onMove(drop.taskId, drop.to, drop.index);
  };

  // Focus follows a keyboard-moved card: crossing columns remounts it, so its grip is found anew.
  useLayoutEffect(() => {
    const id = refocusId.current;
    if (id === null) return;
    refocusId.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-task-id="${id}"] [data-grip]`)?.focus();
  });

  const onKeyboardMove = (taskId: string, key: BoardArrowKey) => {
    if (activeId !== null) return; // a pointer drag is in flight
    const drop = keyboardMove(shown, taskId, key);
    if (!drop) return;
    setAnnouncement(moveAnnouncement(tasksById.get(taskId)?.title ?? '', drop.to, dropPosition(shown, drop)));
    refocusId.current = taskId;
    commit(drop, true);
  };

  // Every drag leaves through here — end AND cancel — so the "drag is over" signal belongs here
  // rather than on `onDragEnd`, which a cancelled drag never reaches.
  const clear = () => {
    setActiveId(null); setOverColumn(null); setInsertion(null); onDragActiveChange?.(false);
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setAnnouncement('');
    onDragActiveChange?.(true);
  };
  const onDragOver = (e: DragOverEvent) => {
    const overId = e.over ? String(e.over.id) : null;
    const to = overColumnKey(shown, overId);
    setOverColumn(to);
    // In its own column dnd-kit's sorting opens the gap; elsewhere a line marks the landing spot.
    const from = overColumnKey(shown, String(e.active.id));
    setInsertion(to === null || to === from || to === 'completed' || overId === null
      ? null
      : { column: to, beforeId: overId.startsWith(COLUMN_DROPPABLE_PREFIX) ? null : overId });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const activeKey = String(e.active.id);
    const from = overColumnKey(shown, activeKey);
    const drop = resolveBoardDrop(shown, activeKey, e.over ? String(e.over.id) : null);
    clear();
    if (drop) commit(drop, drop.to !== from);
  };

  // The board's ids are cuids and `col:<key>` strings; without this a screen reader narrates
  // "Picked up draggable item cm4x8…". A finished move says where the card ended up.
  const announcements = useMemo(() => {
    const titleOf = (id: string) => tasksById.get(id)?.title ?? null;
    const base = makeAnnouncements(titleOf, (id) => boardDropTargetName(shown, id, titleOf));
    return {
      ...base,
      onDragEnd: (args: Parameters<typeof base.onDragEnd>[0]) => {
        const drop = resolveBoardDrop(shown, String(args.active.id), args.over ? String(args.over.id) : null);
        return drop
          ? moveAnnouncement(titleOf(drop.taskId) ?? drop.taskId, drop.to, dropPosition(shown, drop))
          : base.onDragEnd(args);
      },
    };
  }, [shown, tasksById]);

  return (
    <div ref={rootRef} className="min-h-full">
      {/* Keyboard moves bypass dnd-kit, so they announce here. */}
      <div role="status" aria-live="polite" data-testid="board-announcer" className="sr-only">{announcement}</div>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
        collisionDetection={pointerFirstCollision}
        // Expanding a collapsed column or a refetch can move droppables mid-drag; re-measure them.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={clear}
      >
        {/* One grid column per board column. Phones: ~one column per screen, snapped by the pane.
            md+: columns share the width at ≥260px each and the pane scrolls sideways only when they
            cannot all fit (6 × 260 + gaps needs ~1640px) — the prototype's auto-fit grid, minus the
            wrapping onto a second row. */}
        <div data-testid="board" className="grid min-h-full auto-cols-[min(372px,85vw)] grid-flow-col gap-4 md:auto-cols-[minmax(260px,1fr)]">
          {shown.map((c, i) => (
            <Column
              key={c.key} columnKey={c.key} tasks={c.tasks} index={i} now={now} zone={zone} nextMsFor={nextMsFor}
              isTarget={overColumn === c.key && activeId !== null && c.key !== 'completed'}
              insertBefore={insertion?.column === c.key ? insertion.beforeId : undefined}
              collapsed={collapsed.has(c.key)} onToggleCollapsed={() => toggleCollapsed(c.key)}
              emptyText={emptyTextFor(c.key, filtered)}
              suppressFlip={suppressFlip}
              onKeyboardMove={onKeyboardMove}
              onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
              onReorderSubtask={onReorderSubtask}
            />
          ))}
        </div>
        {/* The board is inside a horizontally scrolling pane, so a card dragged between columns
            would be clipped by that scroll container. DragOverlay is NOT portalled — it renders
            right here — but it is position:fixed, so it escapes the pane by being positioned
            against the viewport. That only holds while no ancestor carries a transform/filter/
            backdrop-filter/perspective (or `will-change` / `contain: paint`): any of those makes the
            ancestor the containing block for fixed descendants and the overlay gets clipped again.
            Keep it outside the glass columns and their entrance animation. */}
        <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
          {activeTask ? (
            <div
              data-testid="board-drag-overlay"
              data-tilt=""
              aria-hidden="true"
              style={{ transform: TILT }}
              className="glass-card flex cursor-grabbing items-center gap-2 rounded-card bg-card py-2.5 pl-2.5 pr-3 shadow-lift ring-[1.5px] ring-accent/65"
            >
              <span className="-ml-1 flex h-[30px] w-[18px] shrink-0 items-center justify-center text-accent-fg"><GripDots /></span>
              <span className="h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-fg/30" />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="line-clamp-2 text-[14px] font-medium leading-[1.3] text-fg">{activeTask.title}</span>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
                  <Icons.calendar size={12} className="shrink-0" />{dueShort(activeTask.dueBy, zone)}
                </span>
              </span>
              {activeTask.durationMs >= 60_000 && (
                <span className="chip h-6 shrink-0 px-2 text-[11px]">{formatDurationShort(activeTask.durationMs)}</span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
