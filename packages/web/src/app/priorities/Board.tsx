import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BucketKey, type BoardColumnKey } from './priorityBucket';
import { Column, type ColumnDnd } from './Column';

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
  const [drag, setDrag] = useState<{ id: string | null; over: BoardColumnKey | null; overIndex: number | null }>({ id: null, over: null, overIndex: null });
  const dnd: ColumnDnd = {
    id: drag.id,
    over: drag.over,
    overIndex: drag.overIndex,
    start: (id) => setDrag({ id, over: null, overIndex: null }),
    end: () => setDrag({ id: null, over: null, overIndex: null }),
    setOver: (k, index) => setDrag((d) => (d.over === k && d.overIndex === index ? d : { ...d, over: k, overIndex: index })),
    drop: (to) => { if (drag.id !== null) onMove(drag.id, to, drag.overIndex ?? Number.MAX_SAFE_INTEGER); setDrag({ id: null, over: null, overIndex: null }); },
  };
  return (
    <div className="flex items-start gap-[26px]" style={{ minWidth: 'min-content' }}>
      {columns.map((c) => (
        <Column
          key={c.key} columnKey={c.key} tasks={c.tasks} now={now} nextMsFor={nextMsFor} dnd={dnd}
          onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
          onReorderSubtask={onReorderSubtask}
        />
      ))}
    </div>
  );
}
