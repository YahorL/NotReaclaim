import { useMemo, useState } from 'react';
import type { Task, SchedulePreview, UnscheduledItem } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
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
}

type Tab = 'priorities' | 'tasks';

function dueLabel(task: Task): string | null {
  if (!task.dueBy) return null;
  const d = new Date(task.dueBy);
  return `Due ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function TaskCard({ task, nowMs, nextMs, atRisk, leftBorder, onComplete, onEdit, onDelete }: {
  task: Task; nowMs: number; nextMs: number | null; atRisk: boolean; leftBorder: string;
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
  const due = dueLabel(task);
  const next = nextMs != null ? `Next: ${relativeDayTimeLabel(nextMs, nowMs)}` : null;
  const meta = [due, next].filter(Boolean).join(' · ');
  return (
    <div
      data-testid="panel-task"
      draggable
      onDragStart={(e) => {
        // Firefox aborts HTML5 drags without setData; the custom type lets the grid
        // distinguish a task-card drag from anything else during dragover.
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.setData('application/x-nr-task', task.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title="Drag onto the calendar to schedule"
      className={`group relative flex cursor-grab items-center gap-2.5 border-l-[3px] ${leftBorder} rounded-r-[10px] border-y border-r border-line bg-card px-3 py-2.5 shadow-card active:cursor-grabbing`}
    >
      <button
        type="button"
        aria-label={`Complete ${task.title}`}
        onClick={() => onComplete(task)}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-line text-transparent transition-colors hover:border-indigo hover:text-indigo"
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
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)} className="rounded-md p-1 text-inkSoft hover:bg-bg hover:text-ink">✎</button>
        <button type="button" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task)} className="rounded-md p-1 text-inkSoft hover:bg-crit/10 hover:text-crit">×</button>
      </span>
    </div>
  );
}

export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete }: PlannerTaskPanelProps) {
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
      return Date.parse(a.dueBy ?? '') - Date.parse(b.dueBy ?? '');
    }),
    [active, preview],
  );

  const card = (t: Task, leftBorder: string) => (
    <TaskCard
      key={t.id} task={t} nowMs={nowMs} nextMs={nextBlockMsForTask(t.id, preview)}
      atRisk={atRiskIds.has(t.id)} leftBorder={leftBorder}
      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
    />
  );

  return (
    <aside data-testid="planner-task-panel" className="flex w-[330px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-bg/40">
      <div className="flex shrink-0 gap-1 border-b border-line px-2 pt-2">
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
