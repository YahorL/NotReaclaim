import { useCallback, useRef, useState, type MouseEventHandler, type TouchEventHandler } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Subtask } from '../../api/types';
import { Icons } from '../shell/icons';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { useClickOutside } from '../components/useClickOutside';
import { subtaskDropSortOrder } from '../tasks/subtaskDnd';
import { formatDurationShort } from '../lib/duration';
import { type BoardColumnKey, relativeDayTimeLabel, dueShort } from './priorityBucket';
import { isBoardArrowKey, type BoardArrowKey } from './boardDnd';

const MENU_ITEM = 'block w-full rounded-input px-3 py-1.5 text-left text-[14px] font-medium hover:bg-fg/[.07] focus-visible:bg-fg/[.07] focus-visible:outline-offset-[-2px]';

/** The prototype's 6-dot grip (10×16). */
export function GripDots() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.4" /><circle cx="7.5" cy="3" r="1.4" />
      <circle cx="2.5" cy="8" r="1.4" /><circle cx="7.5" cy="8" r="1.4" />
      <circle cx="2.5" cy="13" r="1.4" /><circle cx="7.5" cy="13" r="1.4" />
    </svg>
  );
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
      data-dragging={isDragging || undefined}
      className="flex flex-col rounded-[10px] px-2 py-1 transition-colors hover:bg-fg/[.05] data-[dragging]:opacity-40"
    >
      <div className="flex items-center gap-2.5 text-[13px]">
        {/* Negative margins cancel the padding, so the halo costs no layout on desktop. The halo
            is deliberately NOT symmetric: 10px sideways (40px wide, nothing is adjacent there) but
            only 4px vertically, because checklist rows stack. Rows are 20px on coarse and the ul
            opens to an 8px gap, so a 28px-tall box exactly meets its neighbour — a symmetric 10px
            halo would be 40px tall against a 24px pitch and each label would steal the taps of the
            checkbox above it. */}
        <label className="flex items-center coarse:-mx-2.5 coarse:px-2.5 coarse:-my-1 coarse:py-1">
          <input
            type="checkbox"
            data-testid={`card-subtask-${subtask.id}`}
            checked={subtask.done}
            onChange={onToggle}
            className="h-4 w-4 accent-accent coarse:h-5 coarse:w-5"
          />
        </label>
        <span className={`transition-colors duration-300 ${subtask.done ? 'text-fg/50 line-through' : 'text-fg/90'}`}>{subtask.title}</span>
      </div>
    </li>
  );
}

export interface TaskRowProps {
  task: Task;
  columnKey: BoardColumnKey;
  nextMs: number | null;
  now: number;
  /** Settings zone the due / next labels are read in. */
  zone: string;
  /** False in the Completed column: no sortable listeners, no grip. */
  draggable?: boolean;
  muted?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
  /** Grip arrow keys: ↑/↓ reorder, ←/→ neighbouring column (Board resolves and announces it). */
  onKeyboardMove?: (taskId: string, key: BoardArrowKey) => void;
}

export function TaskRow({ task, columnKey, nextMs, now, zone, draggable = true, muted = false, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask, onKeyboardMove }: TaskRowProps) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: task.id,
    disabled: !draggable,
    // dnd-kit owns the in-drag reflow; `useFlip` (in Column) owns post-move re-sorts. Leaving
    // both on would double-animate the same movement.
    animateLayoutChanges: () => false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subtaskSensors = useAppSensors();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, closeMenu, menuOpen);
  const done = task.status === 'completed';
  const meta = `${dueShort(task.dueBy, zone)}${nextMs !== null ? ` · Next: ${relativeDayTimeLabel(nextMs, now, zone)}` : ''}`;
  const subtasks = task.subtasks ?? [];
  const subtaskDone = subtasks.filter((s) => s.done).length;
  // Mouse drags start anywhere on the card (a 4px move, so a click still opens the drawer); touch
  // drags start only on the grip, so a swipe on the card body always scrolls the page.
  const { onMouseDown, onTouchStart } = (draggable ? listeners ?? {} : {}) as {
    onMouseDown?: MouseEventHandler; onTouchStart?: TouchEventHandler;
  };
  const onSubtaskDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const sortOrder = subtaskDropSortOrder(subtasks, String(e.active.id), String(e.over.id));
    if (sortOrder !== null) onReorderSubtask(String(e.active.id), sortOrder);
  };

  return (
    <div
      ref={setNodeRef}
      data-testid="task-row" data-task-id={task.id} data-bucket={columnKey}
      data-muted={muted || undefined} data-done={done || undefined}
      // While its clone is in the air the card stays as a dashed placeholder of its own height.
      data-dragging={isDragging || undefined} data-placeholder={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The prototype starts a mouse drag from the card body or the grip, never from its other
      // controls (✓, kebab, checklist).
      onMouseDown={(e) => {
        const hit = (e.target as Element).closest('button, input, label, a');
        if (!hit || hit.hasAttribute('data-grip')) onMouseDown?.(e);
      }}
      onClick={() => onEdit(task)}
      className={`group/card glass-card glass-card-hover relative flex flex-col gap-1.5 rounded-card py-2.5 pl-2.5 pr-2 select-none touch-pan-y ${draggable ? 'cursor-grab' : 'cursor-default'} ${menuOpen ? 'z-20' : ''} data-[muted]:opacity-70 data-[done]:opacity-60 data-[placeholder]:border-dashed data-[placeholder]:border-accent-fg/70 data-[placeholder]:bg-accent-fg/[.06] data-[placeholder]:bg-none data-[placeholder]:opacity-100 data-[placeholder]:shadow-none [&[data-placeholder]>*]:invisible`}
    >
      <div className="flex items-center gap-2">
        {draggable ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            data-grip=""
            aria-label={`Drag ${task.title}`}
            aria-roledescription={attributes['aria-roledescription']}
            aria-describedby={attributes['aria-describedby']}
            onTouchStart={onTouchStart}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (!isBoardArrowKey(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault(); // no page scroll
              onKeyboardMove?.(task.id, e.key);
            }}
            className="-ml-1 flex h-[30px] w-[18px] shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-fg/45 opacity-60 transition hover:bg-fg/[.08] focus-visible:text-fg focus-visible:opacity-100 group-hover/card:text-fg group-hover/card:opacity-100 coarse:-my-1.5 coarse:-ml-2.5 coarse:h-11 coarse:w-9 coarse:opacity-100"
          >
            <GripDots />
          </button>
        ) : (
          <span aria-hidden="true" className="-ml-1 w-[18px] shrink-0" />
        )}
        <button
          type="button" aria-label="complete" aria-pressed={done}
          onClick={(e) => { e.stopPropagation(); onComplete(task); }}
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${done ? 'animate-pop-check border-accent bg-accent text-on-accent' : 'border-fg/30 hover:border-accent-fg'}`}
        >
          {done && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <div className={`line-clamp-2 text-[14px] font-medium leading-[1.3] transition-colors duration-300 ${done ? 'text-fg/50' : 'text-fg'}`}>
            {/* Strike-draw: a 1.5px gradient line whose width grows to 100% when done; `clone`
                repeats it on each wrapped line of the 2-line clamp. */}
            <span className={`bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_58%] bg-no-repeat transition-[background-size] duration-300 ease-out-soft [box-decoration-break:clone] [-webkit-box-decoration-break:clone] ${done ? 'bg-[length:100%_1.5px]' : 'bg-[length:0%_1.5px]'}`}>
              {task.title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-fg-2">
            {/* Icon and text wrap as one unit (the icon used to sit alone above "Due 6/10 · Next…"). */}
            <span data-testid="card-meta" className="inline-flex min-w-0 items-start gap-1.5"><Icons.calendar size={12} className="mt-[2px] shrink-0" /><span>{meta}</span></span>
            {subtasks.length > 0 && (
              <span data-testid="subtask-count" className="ml-1.5 inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>
                {subtaskDone}/{subtasks.length}
              </span>
            )}
          </div>
        </div>
        {task.durationMs >= 60_000 && (
          <span data-testid="duration-chip" className="chip h-6 shrink-0 px-2 text-[11px]">{formatDurationShort(task.durationMs)}</span>
        )}
        <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button" aria-label="task menu" aria-haspopup="true" aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center justify-center rounded-full p-[7px] text-fg/60 transition-colors hover:bg-fg/[.08] hover:text-fg coarse:p-3.5"
          >
            <Icons.dots size={18} />
          </button>
          {menuOpen && (
            <div className="glass-dialog absolute right-0 top-[calc(100%+4px)] z-30 w-[150px] animate-pop rounded-card p-1.5">
              <button type="button" onClick={() => { setMenuOpen(false); onEdit(task); }} className={`${MENU_ITEM} text-fg`}>Edit</button>
              <button type="button" onClick={() => { setMenuOpen(false); onDelete(task); }} className={`${MENU_ITEM} text-danger`}>Delete</button>
            </div>
          )}
        </div>
      </div>
      {subtasks.length > 0 && (
        // Nested inside the board's DndContext. Safe: dnd-kit stamps `dndKit` on the native event
        // when a sensor captures it, so the enclosing card's activator declines — structurally
        // what the old stopPropagation calls were doing by hand.
        <DndContext sensors={subtaskSensors} collisionDetection={pointerFirstCollision} onDragEnd={onSubtaskDragEnd}>
          <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {/* space-y-2 on coarse is the second half of the checkbox-halo fix: it lifts the
                row pitch from 24px to 28px so the padded labels above abut instead of overlap. */}
            <ul
              data-testid="card-subtasks"
              aria-label={`Subtasks of ${task.title}`}
              className="space-y-0.5 pb-0.5 pl-[42px] coarse:space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              {subtasks.map((s) => (
                <SortableCardSubtask key={s.id} subtask={s} onToggle={() => onToggleSubtask(s.id, !s.done)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
