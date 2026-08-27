import { useEffect, useRef, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Subtask } from '../../api/types';
import { Icons } from '../shell/icons';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { subtaskDropSortOrder } from '../tasks/subtaskDnd';
import { type BoardColumnKey, columnMeta, relativeDayTimeLabel } from './priorityBucket';

function dueShort(iso: string | null): string {
  if (!iso) return 'No deadline';
  return `Due ${new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(iso))}`;
}

function SortableCardSubtask({ subtask, onToggle }: { subtask: Subtask; onToggle: () => void }) {
  // role=listitem: dnd-kit would otherwise default the row to role="button", which drops the
  // checklist out of its own semantics and nests the checkbox inside a button.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: subtask.id, attributes: { role: 'listitem' } });
  return (
    <li
      // Both refs: the KeyboardSensor only ignores keys coming from descendants when the row is
      // registered as its own activator node, otherwise Space/Enter on the checkbox is
      // preventDefault'd into a drag instead of toggling the subtask.
      ref={(n) => { setNodeRef(n); setActivatorNodeRef(n); }}
      data-testid={`card-subtask-li-${subtask.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex flex-col ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          data-testid={`card-subtask-${subtask.id}`}
          checked={subtask.done}
          onChange={onToggle}
          className="h-3.5 w-3.5 accent-indigo"
        />
        <span className={subtask.done ? 'text-inkSoft line-through' : 'text-ink'}>{subtask.title}</span>
      </div>
    </li>
  );
}

export interface TaskRowProps {
  task: Task;
  columnKey: BoardColumnKey;
  nextMs: number | null;
  now: number;
  /** False in the Completed column: no sortable listeners, no drag affordance. */
  draggable?: boolean;
  muted?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}

export function TaskRow({ task, columnKey, nextMs, now, draggable = true, muted = false, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: TaskRowProps) {
  const {
    attributes: cardAttributes, listeners: cardListeners, setNodeRef: setCardRef,
    setActivatorNodeRef: setCardActivatorRef,
    transform: cardTransform, transition: cardTransition, isDragging,
  } = useSortable({
    id: task.id,
    disabled: !draggable,
    // dnd-kit owns the in-drag reflow; `useFlip` (in Column) owns post-PATCH re-sorts. Leaving
    // both on would double-animate the same movement.
    animateLayoutChanges: () => false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subtaskSensors = useAppSensors();
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  const done = task.status === 'completed';
  const meta = `${dueShort(task.dueBy)}${nextMs !== null ? ` · Next: ${relativeDayTimeLabel(nextMs, now)}` : ''}`;
  const subtasks = task.subtasks ?? [];
  const subtaskDone = subtasks.filter((s) => s.done).length;
  const colMeta = columnMeta(columnKey);
  const onSubtaskDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const sortOrder = subtaskDropSortOrder(subtasks, String(e.active.id), String(e.over.id));
    if (sortOrder !== null) onReorderSubtask(String(e.active.id), sortOrder);
  };

  return (
    <div
      // Both refs: the KeyboardSensor only ignores keys coming from descendants when the card is
      // registered as its own activator node. Without it, Space/Enter on the ✓ button, the kebab
      // or a checklist checkbox would be preventDefault'd into a card drag.
      ref={(n) => { setCardRef(n); setCardActivatorRef(n); }}
      data-testid="task-row" data-task-id={task.id} data-bucket={columnKey}
      style={{ transform: CSS.Transform.toString(cardTransform), transition: cardTransition }}
      {...(draggable ? cardAttributes : {})}
      {...(draggable ? cardListeners : {})}
      onClick={() => onEdit(task)}
      className={`flex items-start gap-3 border-t border-l-4 border-t-line ${colMeta.leftBorder} bg-card last:rounded-b-xl py-3.5 pl-4 pr-3.5 transition-colors hover:bg-[#fafbfc] ${draggable ? 'cursor-grab' : 'cursor-default'} ${isDragging ? 'opacity-40' : muted ? 'opacity-70' : done ? 'opacity-45' : ''}`}
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
          // Nested inside the board's DndContext (Task 4). Safe: dnd-kit stamps `dndKit` on the
          // native event when a sensor captures it, so the enclosing card's activator declines —
          // structurally what the old stopPropagation calls were doing by hand.
          <DndContext sensors={subtaskSensors} collisionDetection={pointerFirstCollision} onDragEnd={onSubtaskDragEnd}>
            <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul data-testid="card-subtasks" className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
                {subtasks.map((s) => (
                  <SortableCardSubtask key={s.id} subtask={s} onToggle={() => onToggleSubtask(s.id, !s.done)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
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
