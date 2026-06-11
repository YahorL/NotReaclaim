import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BoardColumnKey, columnMeta } from './priorityBucket';
import { TasksCard } from './TasksCard';
import { TaskRow } from './TaskRow';

export interface ColumnDnd {
  id: string | null;
  over: BoardColumnKey | null;
  overIndex: number | null;
  start: (id: string) => void;
  end: () => void;
  setOver: (k: BoardColumnKey, index: number) => void;
  drop: (to: BoardColumnKey) => void;
}

export interface ColumnProps {
  columnKey: BoardColumnKey;
  tasks: Task[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  dnd: ColumnDnd;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
}

export function Column({ columnKey, tasks, now, nextMsFor, dnd, onComplete, onEdit, onDelete, onToggleSubtask }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCompleted = columnKey === 'completed';
  const isDropTarget = !isCompleted;
  const isTarget = dnd.over === columnKey && dnd.id !== null && isDropTarget;
  const meta = columnMeta(columnKey);

  return (
    <div
      data-testid={`column-${columnKey}`}
      onDragOver={(e) => { if (isDropTarget && dnd.id !== null) { e.preventDefault(); dnd.setOver(columnKey, tasks.length); } }}
      onDrop={(e) => { if (isDropTarget) { e.preventDefault(); dnd.drop(columnKey); } }}
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
          {tasks.length > 0 ? (
            <TasksCard count={tasks.length}>
              {tasks.map((t, i) => (
                <div
                  key={t.id}
                  className="last:rounded-b-xl overflow-hidden"
                  onDragOver={(e) => {
                    if (!isDropTarget || dnd.id === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const idx = r.height > 0 && e.clientY >= r.top + r.height / 2 ? i + 1 : i;
                    dnd.setOver(columnKey, idx);
                  }}
                >
                  {dnd.over === columnKey && dnd.overIndex === i && (
                    <div data-testid="insert-line" className="h-0.5 bg-indigo" />
                  )}
                  <TaskRow
                    task={t} columnKey={columnKey} now={now} nextMs={nextMsFor(t.id)}
                    dragging={dnd.id === t.id}
                    draggable={!isCompleted}
                    muted={columnKey === 'backlog'}
                    onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
                    onDragStart={dnd.start} onDragEnd={dnd.end}
                  />
                  {i === tasks.length - 1 && dnd.over === columnKey && dnd.overIndex === tasks.length && (
                    <div data-testid="insert-line" className="h-0.5 bg-indigo" />
                  )}
                </div>
              ))}
            </TasksCard>
          ) : (
            <div className={`rounded-xl border-[1.5px] px-1 py-[22px] text-center text-[14.5px] ${isTarget ? 'border-dashed border-indigo font-bold text-indigo' : 'border-transparent text-[#aeb2c0]'}`}>
              {isTarget ? 'Drop to move here' : 'Nothing here yet'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
