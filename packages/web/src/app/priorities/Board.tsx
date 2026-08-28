import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { type BoardColumnKey, BUCKET_META, priorityToBucket } from './priorityBucket';
import { makeAnnouncements } from '../dnd/announcements';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { boardDropTargetName, boardKeyboardCoordinates, overColumnKey, resolveBoardDrop } from './boardDnd';
import { Column } from './Column';

export interface BoardColumn { key: BoardColumnKey; tasks: Task[]; }

export interface BoardProps {
  columns: BoardColumn[];
  now: number;
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
}

export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask, onDragActiveChange }: BoardProps) {
  // The board registers container droppables (`col:*`) alongside the cards, so it needs the
  // container-blind arrow getter — see `boardKeyboardCoordinates`.
  const sensors = useAppSensors(boardKeyboardCoordinates);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardColumnKey | null>(null);
  const activeTask = columns.flatMap((c) => c.tasks).find((t) => t.id === activeId) ?? null;

  // Every drag leaves through here — end AND cancel — so the "drag is over" signal belongs here
  // rather than on `onDragEnd`, which a cancelled drag never reaches.
  const clear = () => { setActiveId(null); setOverColumn(null); onDragActiveChange?.(false); };

  const onDragStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)); onDragActiveChange?.(true); };
  const onDragOver = (e: DragOverEvent) => setOverColumn(overColumnKey(columns, e.over ? String(e.over.id) : null));
  const onDragEnd = (e: DragEndEvent) => {
    const drop = resolveBoardDrop(columns, String(e.active.id), e.over ? String(e.over.id) : null);
    clear();
    if (drop) onMove(drop.taskId, drop.to, drop.index);
  };

  // The board's ids are cuids and `col:<key>` strings; without this a screen reader narrates
  // "Picked up draggable item cm4x8…". Keyboard dragging is real here, so the stock
  // screenReaderInstructions stay — only the announcements change.
  const announcements = useMemo(() => {
    const titleOf = (id: string) => columns.flatMap((c) => c.tasks).find((t) => t.id === id)?.title ?? null;
    return makeAnnouncements(titleOf, (id) => boardDropTargetName(columns, id, titleOf));
  }, [columns]);

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={clear}
    >
      <div className="flex items-start gap-[26px]" style={{ minWidth: 'min-content' }}>
        {columns.map((c) => (
          <Column
            key={c.key} columnKey={c.key} tasks={c.tasks} now={now} nextMsFor={nextMsFor}
            isTarget={overColumn === c.key && activeId !== null && c.key !== 'completed'}
            onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
            onReorderSubtask={onReorderSubtask}
          />
        ))}
      </div>
      {/* The board is inside a horizontally scrolling pane, so a card dragged between columns
          would be clipped by that scroll container. DragOverlay is NOT portalled — it renders
          right here — but it is position:fixed, so it escapes the pane by being positioned
          against the viewport. That only holds while no ancestor carries a transform/filter/
          perspective (or `will-change` / `contain: paint`): any of those makes the ancestor the
          containing block for fixed descendants and the overlay gets clipped again. */}
      <DragOverlay>
        {activeTask ? (
          <div
            data-testid="board-drag-overlay"
            className={`w-[340px] rounded-xl border border-l-4 border-line ${BUCKET_META[priorityToBucket(activeTask.priority)].leftBorder} bg-card px-4 py-3.5 text-[16px] font-semibold text-ink shadow-pop`}
          >
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
