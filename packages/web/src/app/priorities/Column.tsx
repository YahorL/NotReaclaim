import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task } from '../../api/types';
import { type BoardColumnKey, columnMeta } from './priorityBucket';
import { columnDroppableId } from './boardDnd';
import { TasksCard } from './TasksCard';
import { TaskRow } from './TaskRow';
import { useFlip } from './useFlip';

export interface ColumnProps {
  columnKey: BoardColumnKey;
  tasks: Task[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  /** True while a drag is hovering this column (Board resolves it once for the whole board). */
  isTarget: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}

export function Column({ columnKey, tasks, now, nextMsFor, isTarget, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCompleted = columnKey === 'completed';
  const meta = columnMeta(columnKey);
  // `useFlip` no longer animates the drag itself (dnd-kit's sorting strategy does). It survives
  // for movement the user did not drag: the post-PATCH refetch, a WS-driven re-sort, a filter.
  const setFlipRef = useFlip(tasks.map((t) => t.id).join('|'));
  // The whole column is a drop target so a card can land in its empty area (the old
  // `onDragOver` → `setOver(columnKey, tasks.length)` behaviour). Completed rejects drops.
  const { setNodeRef } = useDroppable({ id: columnDroppableId(columnKey), disabled: isCompleted });

  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${columnKey}`}
      className={`shrink-0 transition-[width] ${collapsed ? 'w-[250px]' : 'w-[372px]'}`}
    >
      <div className="mb-3 flex items-center pr-1">
        <span className="flex-1 text-[16.5px] font-bold text-inkSoft">{meta.label}</span>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)} className="text-[15.5px] font-bold text-indigo">
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className={`rounded-[13px] ${isTarget ? 'outline-dashed outline-2 outline-offset-[3px] outline-indigo' : ''}`}>
          <SortableContext id={columnKey} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.length > 0 ? (
              <TasksCard count={tasks.length}>
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    ref={setFlipRef(t.id)}
                    className="last:[&>[data-testid=task-row]]:rounded-b-xl"
                  >
                    <TaskRow
                      task={t} columnKey={columnKey} now={now} nextMs={nextMsFor(t.id)}
                      draggable={!isCompleted}
                      muted={columnKey === 'backlog'}
                      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
                      onReorderSubtask={onReorderSubtask}
                    />
                  </div>
                ))}
              </TasksCard>
            ) : (
              <div className={`rounded-xl border-[1.5px] px-1 py-[22px] text-center text-[14.5px] ${isTarget ? 'border-dashed border-indigo font-bold text-indigo' : 'border-transparent text-[#aeb2c0]'}`}>
                {isTarget ? 'Drop to move here' : 'Nothing here yet'}
              </div>
            )}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
