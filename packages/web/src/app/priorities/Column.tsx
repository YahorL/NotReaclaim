import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BucketKey, BUCKET_META } from './priorityBucket';
import { TasksCard } from './TasksCard';
import { TaskRow } from './TaskRow';

export interface ColumnDnd {
  id: string | null;
  over: BucketKey | null;
  start: (id: string) => void;
  end: () => void;
  setOver: (k: BucketKey) => void;
  drop: (to: BucketKey) => void;
}

export interface ColumnProps {
  bucket: BucketKey;
  tasks: Task[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  dnd: ColumnDnd;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
}

export function Column({ bucket, tasks, now, nextMsFor, dnd, onComplete, onEdit, onDelete, onToggleSubtask }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isTarget = dnd.over === bucket && dnd.id !== null;

  return (
    <div
      data-testid={`column-${bucket}`}
      onDragOver={(e) => { if (dnd.id !== null) { e.preventDefault(); dnd.setOver(bucket); } }}
      onDrop={(e) => { e.preventDefault(); dnd.drop(bucket); }}
      className={`shrink-0 transition-[width] ${collapsed ? 'w-[250px]' : 'w-[372px]'}`}
    >
      <div className="mb-3 flex items-center pr-1">
        <span className="flex-1 text-[16.5px] font-bold text-inkSoft">{BUCKET_META[bucket].label}</span>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)} className="text-[15.5px] font-bold text-indigo">
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className={`rounded-[13px] ${isTarget ? 'outline-dashed outline-2 outline-offset-[3px] outline-indigo' : ''}`}>
          {tasks.length > 0 ? (
            <TasksCard count={tasks.length}>
              {tasks.map((t) => (
                <TaskRow
                  key={t.id} task={t} bucket={bucket} now={now} nextMs={nextMsFor(t.id)}
                  dragging={dnd.id === t.id}
                  onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
                  onDragStart={dnd.start} onDragEnd={dnd.end}
                />
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
