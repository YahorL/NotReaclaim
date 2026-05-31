import { useState } from 'react';
import type { Task } from '../../api/types';
import { formatDurationShort } from '../lib/duration';

export interface TaskRowProps {
  task: Task;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskRow({ task, onEdit, onComplete, onDelete }: TaskRowProps) {
  const [confirming, setConfirming] = useState(false);
  const completed = task.status === 'completed';
  const due = new Date(task.dueBy).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <div data-testid="task-row" className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm">
      <span className={`flex-1 font-medium ${completed ? 'text-gray-400 line-through' : ''}`}>{task.title}</span>
      {task.category && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-600">{task.category}</span>}
      <span className="text-xs text-gray-500">{formatDurationShort(task.durationMs)} · due {due} · P{task.priority}</span>
      {confirming ? (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Delete?</span>
          <button onClick={() => onDelete(task)} className="text-red-600">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-gray-600">Cancel</button>
        </span>
      ) : (
        <span className="flex gap-1">
          <button onClick={() => onEdit(task)} className="rounded border border-gray-200 px-1.5 text-xs">edit</button>
          {!completed && (
            <button aria-label="complete" onClick={() => onComplete(task)} className="rounded border border-gray-200 px-1.5 text-xs text-green-600">✓</button>
          )}
          <button aria-label="delete" onClick={() => setConfirming(true)} className="rounded border border-gray-200 px-1.5 text-xs text-red-600">×</button>
        </span>
      )}
    </div>
  );
}
