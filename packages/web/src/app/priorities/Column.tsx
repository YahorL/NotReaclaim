import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task } from '../../api/types';
import { Icons } from '../shell/icons';
import { type BoardColumnKey, columnMeta } from './priorityBucket';
import { columnDroppableId, type BoardArrowKey } from './boardDnd';
import { TaskRow } from './TaskRow';
import { useFlip } from './useFlip';

export interface ColumnProps {
  columnKey: BoardColumnKey;
  tasks: Task[];
  /** Position among the rendered columns; staggers the entrance. */
  index: number;
  now: number;
  /** Settings zone the cards' date labels are read in. */
  zone: string;
  nextMsFor: (taskId: string) => number | null;
  /** True while a drag is hovering this column (Board resolves it once for the whole board). */
  isTarget: boolean;
  /**
   * A pointer drag from another column would land here: before this card id, or at the end (null).
   * Undefined when no such drag hovers this column. Drawn as a line that takes no space, so the
   * cards under the pointer never shift (which would flip the hovered card back and forth).
   */
  insertBefore?: string | null;
  /** Record the new card positions without animating (see `useFlip`). */
  suppressFlip?: boolean;
  onKeyboardMove?: (taskId: string, key: BoardArrowKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Empty-state copy: "Drop tasks here", or "No matching tasks" while a search is active. */
  emptyText: string;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}

export function Column({
  columnKey, tasks, index, now, zone, nextMsFor, isTarget, insertBefore, suppressFlip = false, onKeyboardMove,
  collapsed, onToggleCollapsed, emptyText, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask,
}: ColumnProps) {
  const isCompleted = columnKey === 'completed';
  const meta = columnMeta(columnKey);
  // `useFlip` does not animate the drag itself (dnd-kit's sorting strategy does). It owns movement
  // the user did not drag: a keyboard move, a refetch, a WS-driven re-sort, a filter.
  const setFlipRef = useFlip(tasks.map((t) => t.id).join('|'), suppressFlip);
  // The whole grid cell is a drop target (it stretches to the row's height), so a card can land in
  // a column's empty area or on a collapsed column's header. Completed rejects drops.
  const { setNodeRef } = useDroppable({ id: columnDroppableId(columnKey), disabled: isCompleted });

  return (
    // The grid stretches each column cell to the board's height so the empty space below the cards
    // accepts a drop. A collapsed column shows only its header, so it keeps to its own height
    // (self-start): stretched, it would accept drops all the way down with nothing visible there.
    <div ref={setNodeRef} data-testid={`column-${columnKey}`} className={`flex min-w-0 snap-start flex-col ${collapsed ? 'self-start' : ''}`}>
      <section
        aria-label={meta.label}
        data-drop-target={isTarget || undefined}
        data-collapsed={collapsed || undefined}
        style={{ animationDelay: `${index * 60}ms` }}
        className="glass flex animate-rise flex-col gap-1.5 rounded-panel p-3 transition-[border-color,box-shadow] duration-200 data-[drop-target]:border-accent-fg/45 data-[drop-target]:shadow-[0_0_0_1px_rgb(var(--c-accent-text)/0.2),var(--x-panel-shadow)]"
      >
        <div className="flex items-center gap-2.5 pb-1.5 pl-2 pr-1 pt-1">
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${meta.glow}`} />
          <h2 className="min-w-0 truncate text-[16px] font-medium text-fg">{meta.label}</h2>
          <span data-testid={`column-count-${columnKey}`} className="chip h-6 shrink-0 px-2.5 text-[11px]">{tasks.length}</span>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${meta.label}`}
            onClick={onToggleCollapsed}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg/60 transition-colors hover:bg-fg/[.08] hover:text-fg"
          >
            <Icons.chevUp size={16} className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {!collapsed && (
          // `relative`: the cards' offset parent, which `useFlip` measures against.
          <div className="relative flex min-h-[52px] flex-col gap-1.5">
            <SortableContext id={columnKey} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {tasks.map((t) => (
                <div key={t.id} ref={setFlipRef(t.id)} className="relative">
                  {insertBefore === t.id && <DropLine className="-top-1" />}
                  <TaskRow
                    task={t} columnKey={columnKey} now={now} zone={zone} nextMs={nextMsFor(t.id)}
                    draggable={!isCompleted}
                    muted={columnKey === 'backlog'}
                    onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
                    onReorderSubtask={onReorderSubtask} onKeyboardMove={onKeyboardMove}
                  />
                </div>
              ))}
            </SortableContext>
            {insertBefore === null && tasks.length > 0 && <DropLine className="-bottom-1" />}
            {tasks.length === 0 && (
              <div
                data-testid={`column-empty-${columnKey}`}
                className={`rounded-[14px] border border-dashed px-2.5 py-3.5 text-center text-[13px] transition-colors ${isTarget ? 'border-accent-fg/70 bg-accent-fg/[.06] text-fg' : 'border-fg/[.12] text-fg-2'}`}
              >
                {emptyText}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The landing line for a drag from another column (3px, centred in the 6px card gap). Drawn in
 * `accent-fg` (lime in dark, olive in light): the light lime fill is ~1.1:1 on light cards.
 */
function DropLine({ className }: { className: string }) {
  return (
    <span
      data-testid="drop-indicator"
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-2 z-10 h-[3px] -translate-y-px rounded-full bg-accent-fg shadow-[0_0_10px_rgb(var(--c-accent-glow)/0.7)] ${className}`}
    />
  );
}
