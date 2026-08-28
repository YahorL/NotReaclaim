import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task, SchedulePreview, UnscheduledItem } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
import { PANEL_TASK_DRAG_TYPE } from './scheduleDrop';
import {
  BUCKETS, BUCKET_META, priorityToBucket, sortBucket, relativeDayTimeLabel, nextBlockMsForTask,
} from '../priorities/priorityBucket';

export interface PlannerTaskPanelProps {
  tasks: Task[];
  preview: SchedulePreview | undefined;
  nowMs: number;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Rendered inside a bottom sheet: fill the sheet instead of holding the 330px desktop width. */
  compact?: boolean;
  /** Coarse pointer: there is no hover, so the card's edit/delete stay visible. */
  coarse?: boolean;
}

type Tab = 'priorities' | 'tasks';

function dueLabel(task: Task): string | null {
  if (!task.dueBy) return null;
  const d = new Date(task.dueBy);
  return `Due ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function TaskCard({ task, nowMs, nextMs, atRisk, leftBorder, coarse, onComplete, onEdit, onDelete }: {
  task: Task; nowMs: number; nextMs: number | null; atRisk: boolean; leftBorder: string; coarse: boolean;
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
  const due = dueLabel(task);
  const next = nextMs != null ? `Next: ${relativeDayTimeLabel(nextMs, nowMs)}` : null;
  const meta = [due, next].filter(Boolean).join(' · ');
  // The overlay card follows the pointer, so this one stays put and only dims.
  // role=group: dnd-kit would otherwise default the card to role="button", nesting the
  // complete/edit/delete buttons inside a button.
  // tabIndex=-1 overrides dnd-kit's default 0: this surface is pointer/touch-only (no
  // KeyboardSensor — see useDragToScheduleSensors), so a focusable card would be a dead tab stop
  // whose "press space bar to lift" description promises a gesture nothing here implements.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `panel-task:${task.id}`,
    data: { type: PANEL_TASK_DRAG_TYPE, taskId: task.id },
    attributes: { role: 'group', tabIndex: -1 },
  });
  return (
    <div
      // Both refs on the same element: the activator node is what dnd-kit restores focus to after
      // a drag (it falls back to the first focusable descendant, i.e. the ✓ button, since the card
      // itself is not focusable) and what a KeyboardSensor would require an activation keydown to
      // originate on — declaring it keeps that contract true if this surface ever gains one.
      ref={(n) => { setNodeRef(n); setActivatorNodeRef(n); }}
      data-testid="panel-task"
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      title="Drag onto the calendar to schedule"
      className={`group relative flex cursor-grab items-center gap-2.5 border-l-[3px] ${leftBorder} rounded-r-[10px] border-y border-r border-line bg-card px-3 py-2.5 shadow-card active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        aria-label={`Complete ${task.title}`}
        onClick={() => onComplete(task)}
        // The 20px ring is the visual, so it keeps its size and grows an invisible hit box
        // instead. Safe here because nothing sits adjacent to it on the left.
        className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line text-transparent transition-colors hover:border-indigo hover:text-indigo coarse:before:absolute coarse:before:-inset-3 coarse:before:content-['']"
      >
        ✓
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-bold text-ink">{task.title}</span>
          {atRisk && <span data-testid="panel-at-risk" title="At risk" className="shrink-0 rounded-full bg-crit/15 px-1.5 text-[10px] font-bold text-crit">⚠</span>}
        </div>
        {meta && <div className="mt-0.5 truncate text-[12px] text-inkSoft">{meta}</div>}
        {(() => {
          const spent = task.spentMs ?? 0;
          const pct = task.durationMs > 0 ? Math.min(100, (spent / task.durationMs) * 100) : 0;
          return (
            <div data-testid="panel-progress" className="mt-1 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-[11px] text-inkSoft">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)}</span>
            </div>
          );
        })()}
      </div>
      <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-semibold text-inkSoft">{formatDurationShort(task.durationMs)}</span>
      {/* ✎ and × are adjacent, so they grow by padding, never by a pseudo box: overlapping
          hit areas would let × steal ✎'s taps. The wider gap keeps them apart. */}
      <span className={`flex shrink-0 items-center gap-0.5 transition-opacity coarse:gap-2 ${coarse ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button type="button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)} className="rounded-md p-1 text-inkSoft hover:bg-bg hover:text-ink coarse:p-3">✎</button>
        <button type="button" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task)} className="rounded-md p-1 text-inkSoft hover:bg-crit/10 hover:text-crit coarse:p-3">×</button>
      </span>
    </div>
  );
}

export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete, compact = false, coarse = false }: PlannerTaskPanelProps) {
  const [tab, setTab] = useState<Tab>('priorities');

  const active = useMemo(
    () => tasks.filter((t) => t.status === 'pending' || t.status === 'scheduled'),
    [tasks],
  );
  const atRiskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of (preview?.unscheduled ?? []) as UnscheduledItem[]) {
      if (it.sourceType === 'task') ids.add(it.sourceId);
    }
    return ids;
  }, [preview]);

  const grouped = useMemo(
    () => BUCKETS.map((b) => ({
      bucket: b,
      tasks: sortBucket(active.filter((t) => priorityToBucket(t.priority) === b)),
    })).filter((g) => g.tasks.length > 0),
    [active],
  );

  const flat = useMemo(
    () => [...active].sort((a, b) => {
      const an = nextBlockMsForTask(a.id, preview) ?? Number.MAX_SAFE_INTEGER;
      const bn = nextBlockMsForTask(b.id, preview) ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      // An undated task sorts last: its due key is `Infinity`, greater than any timestamp.
      const ad = a.dueBy ? Date.parse(a.dueBy) : Infinity;
      const bd = b.dueBy ? Date.parse(b.dueBy) : Infinity;
      return ad - bd;
    }),
    [active, preview],
  );

  const card = (t: Task, leftBorder: string) => (
    <TaskCard
      key={t.id} task={t} nowMs={nowMs} nextMs={nextBlockMsForTask(t.id, preview)}
      atRisk={atRiskIds.has(t.id)} leftBorder={leftBorder} coarse={coarse}
      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
    />
  );

  return (
    <aside data-testid="planner-task-panel" className={`flex flex-col overflow-hidden rounded-[14px] border border-line bg-bg/40 ${compact ? 'min-h-0 w-full flex-1' : 'w-[330px] shrink-0'}`}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 pt-2">
        {(['priorities', 'tasks'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex-1 rounded-t-[9px] px-3 py-2 text-[14px] font-bold capitalize transition-colors ${tab === t ? 'border-b-2 border-indigo text-ink' : 'text-inkSoft hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {active.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-inkSoft">No active tasks.</p>}

        {tab === 'priorities' && grouped.map((g) => (
          <div key={g.bucket} className="space-y-1.5">
            <div className="flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${BUCKET_META[g.bucket].dot}`} />
              <span className="text-[12.5px] font-bold uppercase tracking-wide text-inkSoft">{BUCKET_META[g.bucket].label}</span>
              <span className="text-[11.5px] text-inkSoft">{g.tasks.length}</span>
            </div>
            {g.tasks.map((t) => card(t, BUCKET_META[g.bucket].leftBorder))}
          </div>
        ))}

        {tab === 'tasks' && (
          <div className="space-y-1.5">
            {flat.map((t) => card(t, BUCKET_META[priorityToBucket(t.priority)].leftBorder))}
          </div>
        )}
      </div>
    </aside>
  );
}
