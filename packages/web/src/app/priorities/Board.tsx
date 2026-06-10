import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BucketKey } from './priorityBucket';
import { Column, type ColumnDnd } from './Column';

export interface BoardColumn { key: BucketKey; tasks: Task[]; }

export interface BoardProps {
  columns: BoardColumn[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  onMove: (taskId: string, to: BucketKey) => void;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
}

export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask }: BoardProps) {
  const [drag, setDrag] = useState<{ id: string | null; over: BucketKey | null }>({ id: null, over: null });
  const dnd: ColumnDnd = {
    id: drag.id,
    over: drag.over,
    start: (id) => setDrag({ id, over: null }),
    end: () => setDrag({ id: null, over: null }),
    setOver: (k) => setDrag((d) => (d.over === k ? d : { ...d, over: k })),
    drop: (to) => { if (drag.id !== null) onMove(drag.id, to); setDrag({ id: null, over: null }); },
  };
  return (
    <div className="flex items-start gap-[26px]" style={{ minWidth: 'min-content' }}>
      {columns.map((c) => (
        <Column
          key={c.key} bucket={c.key} tasks={c.tasks} now={now} nextMsFor={nextMsFor} dnd={dnd}
          onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
        />
      ))}
    </div>
  );
}
