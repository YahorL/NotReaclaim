import { useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { type BoardColumnKey, BUCKET_META, priorityToBucket } from './priorityBucket';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { overColumnKey, resolveBoardDrop } from './boardDnd';
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
}

export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: BoardProps) {
  const sensors = useAppSensors();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardColumnKey | null>(null);
  const activeTask = columns.flatMap((c) => c.tasks).find((t) => t.id === activeId) ?? null;

  const clear = () => { setActiveId(null); setOverColumn(null); };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOverColumn(overColumnKey(columns, e.over ? String(e.over.id) : null));
  const onDragEnd = (e: DragEndEvent) => {
    const drop = resolveBoardDrop(columns, String(e.active.id), e.over ? String(e.over.id) : null);
    clear();
    if (drop) onMove(drop.taskId, drop.to, drop.index);
  };

  return (
    <DndContext
      sensors={sensors}
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
          would be clipped by that scroll container. The overlay is portalled above everything. */}
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
