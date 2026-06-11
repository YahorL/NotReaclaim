import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../api/types';
import { Icons } from '../shell/icons';
import { type BoardColumnKey, columnMeta, relativeDayTimeLabel } from './priorityBucket';

function dueShort(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

export interface TaskRowProps {
  task: Task;
  columnKey: BoardColumnKey;
  nextMs: number | null;
  now: number;
  dragging: boolean;
  draggable?: boolean;
  muted?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
}

export function TaskRow({ task, columnKey, nextMs, now, dragging, draggable = true, muted = false, onComplete, onEdit, onDelete, onDragStart, onDragEnd, onToggleSubtask }: TaskRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  const done = task.status === 'completed';
  const meta = `Due ${dueShort(task.dueBy)}${nextMs !== null ? ` · Next: ${relativeDayTimeLabel(nextMs, now)}` : ''}`;
  const subtasks = task.subtasks ?? [];
  const subtaskDone = subtasks.filter((s) => s.done).length;
  const colMeta = columnMeta(columnKey);

  return (
    <div
      data-testid="task-row" data-task-id={task.id} data-bucket={columnKey}
      draggable={draggable}
      onDragStart={(e) => { if (!draggable) return; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); } onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      onClick={() => onEdit(task)}
      className={`flex items-start gap-3 border-t border-l-4 border-t-line ${colMeta.leftBorder} bg-card last:rounded-b-xl py-3.5 pl-4 pr-3.5 transition-colors hover:bg-[#fafbfc] ${draggable ? 'cursor-grab' : 'cursor-default'} ${dragging ? 'opacity-40' : muted ? 'opacity-70' : done ? 'opacity-45' : ''}`}
    >
      <button
        type="button" aria-label="complete"
        onClick={(e) => { e.stopPropagation(); onComplete(task); }}
        className={`mt-0.5 ${done ? 'text-low' : 'text-[#b9bdcb]'}`}
      >
        <Icons.check size={21} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-[16px] font-semibold text-ink ${done ? 'line-through' : ''}`}>{task.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[14px] text-inkSoft">
          <Icons.calendar size={15} /><span>{meta}</span>
          {subtasks.length > 0 && (
            <span data-testid="subtask-count" className="flex items-center gap-1">
              <Icons.check size={13} />{subtaskDone}/{subtasks.length}
            </span>
          )}
        </div>
        {subtasks.length > 0 && (
          <ul data-testid="card-subtasks" className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  data-testid={`card-subtask-${s.id}`}
                  checked={s.done}
                  onChange={() => onToggleSubtask(s.id, !s.done)}
                  className="h-3.5 w-3.5 accent-indigo"
                />
                <span className={s.done ? 'text-inkSoft line-through' : 'text-ink'}>{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="task menu" onClick={() => setMenuOpen((v) => !v)} className="rounded-md p-1 text-inkSoft hover:bg-[#eef0f4]">
          <Icons.dots size={18} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-[140px] animate-pop rounded-lg border border-line bg-card p-1 shadow-pop">
            <button type="button" onClick={() => { setMenuOpen(false); onEdit(task); }} className="block w-full rounded px-3 py-1.5 text-left text-[14px] hover:bg-bg">Edit</button>
            <button type="button" onClick={() => { setMenuOpen(false); onDelete(task); }} className="block w-full rounded px-3 py-1.5 text-left text-[14px] text-crit hover:bg-bg">Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
