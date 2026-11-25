import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task, SchedulePreview } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
import { Icons } from '../shell/icons';
import { PANEL_TASK_DRAG_TYPE, panelTaskDraggableId } from './scheduleDrop';
import { sortByDue, splitShown, PANEL_GROUP_LIMIT } from './panelTasks';
import {
  BUCKETS, isActiveTask, priorityToBucket, sortBucket, relativeDayTimeLabel, nextBlockMsForTask, dueLabel, type BucketKey,
} from '../priorities/priorityBucket';

export type PanelTab = 'priorities' | 'tasks';

/** A ticked card still listed this long after the click (the save failed) un-ticks. */
const UNTICK_AFTER_MS = 4000;

export interface PlannerTaskPanelProps {
  tasks: Task[];
  preview: SchedulePreview | undefined;
  nowMs: number;
  /** Settings zone the due / next labels are read in. */
  zone: string;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Rendered inside a bottom sheet: fill the sheet instead of holding the 330px desktop width. */
  compact?: boolean;
  /** Coarse pointer: there is no hover, so the card's edit/delete stay visible. */
  coarse?: boolean;
  /** Controlled tab (the summary card's "+N more" switches to All tasks). Uncontrolled without it. */
  tab?: PanelTab;
  onTabChange?: (tab: PanelTab) => void;
}

const TABS: readonly { key: PanelTab; label: string }[] = [
  { key: 'priorities', label: 'Priorities' },
  { key: 'tasks', label: 'All tasks' },
];

/** Priority dot + group label on tokens. The dot glows in its own colour (`bg-current` + shadow). */
const GROUP_META: Record<BucketKey, { label: string; short: string; dot: string }> = {
  critical: { label: 'Critical', short: 'Critical', dot: 'text-pri-crit' },
  high: { label: 'High priority', short: 'High', dot: 'text-pri-high' },
  medium: { label: 'Medium priority', short: 'Medium', dot: 'text-pri-med' },
  low: { label: 'Low priority', short: 'Low', dot: 'text-pri-low' },
};

function Dot({ bucket }: { bucket: BucketKey }) {
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full bg-current shadow-[0_0_8px_currentColor] ${GROUP_META[bucket].dot}`} />;
}

function TaskCard({ task, nowMs, zone, nextMs, atRisk, showPriority, coarse, onComplete, onEdit, onDelete }: {
  task: Task; nowMs: number; zone: string; nextMs: number | null; atRisk: boolean; showPriority: boolean; coarse: boolean;
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
  const due = dueLabel(task.dueBy, zone) ?? 'No deadline';
  const next = nextMs != null ? `Next: ${relativeDayTimeLabel(nextMs, nowMs, zone)}` : null;
  const spent = task.spentMs ?? 0;
  const pct = task.durationMs > 0 ? Math.min(100, (spent / task.durationMs) * 100) : 0;
  const bucket = priorityToBucket(task.priority);
  // Ticking it off pops the check and draws a strike through the title (spec §5.6) while the
  // completion is saved; the card then leaves the active list. If it is still here a while later
  // (the save failed), it un-ticks.
  const [ticked, setTicked] = useState(false);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tickTimer.current) clearTimeout(tickTimer.current); }, []);
  const complete = () => {
    setTicked(true);
    if (tickTimer.current) clearTimeout(tickTimer.current);
    tickTimer.current = setTimeout(() => { tickTimer.current = null; setTicked(false); }, UNTICK_AFTER_MS);
    onComplete(task);
  };
  // The overlay card follows the pointer, so this one stays put and only dims.
  // role=group: dnd-kit would otherwise default the card to role="button", nesting the
  // complete/edit/delete buttons inside a button.
  // tabIndex=-1 overrides dnd-kit's default 0: this surface is pointer/touch-only (no
  // KeyboardSensor — see useDragToScheduleSensors), so a focusable card would be a dead tab stop
  // whose "press space bar to lift" description promises a gesture nothing here implements.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: panelTaskDraggableId(task.id),
    data: { type: PANEL_TASK_DRAG_TYPE, taskId: task.id },
    attributes: { role: 'group', tabIndex: -1 },
  });
  return (
    <div
      // Both refs on the same element: the activator node is what dnd-kit restores focus to after
      // a drag — `findFirstFocusableNode` matches `*[tabindex]`, so `tabIndex: -1` keeps this card
      // programmatically focusable while removing the dead tab stop — and it is what a
      // KeyboardSensor would require an activation keydown to originate on, which keeps that
      // contract true if this surface ever gains one.
      ref={(n) => { setNodeRef(n); setActivatorNodeRef(n); }}
      data-testid="panel-task"
      data-task-id={task.id}
      data-dragging={isDragging || undefined}
      {...attributes}
      {...listeners}
      title="Drag onto the calendar to schedule"
      className={`glass-card glass-card-hover group relative flex cursor-grab items-center gap-2.5 rounded-card py-2.5 pl-3 pr-2.5 active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        aria-label={`Complete ${task.title}`}
        data-ticked={ticked || undefined}
        onClick={complete}
        // The 22px ring is the visual, so it keeps its size and grows an invisible hit box
        // instead. Safe here because nothing sits adjacent to it on the left.
        className={`relative grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors coarse:before:absolute coarse:before:-inset-3 coarse:before:content-[''] ${ticked ? 'animate-pop-check border-accent bg-accent text-on-accent' : 'border-fg/30 text-transparent hover:border-accent-fg hover:text-accent-fg'}`}
      >
        <Icons.check size={14} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Strike-draw: a 1.5px line grows left → right as a background (prototype .tk-title). */}
          <span
            data-testid="panel-task-title"
            className={`truncate bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_56%] bg-no-repeat text-[14px] font-medium transition-[background-size,color] duration-[350ms] ${ticked ? 'bg-[length:100%_1.5px] text-fg-2' : 'bg-[length:0_1.5px] text-fg'}`}
          >
            {task.title}
          </span>
          {atRisk && (
            <span data-testid="panel-at-risk" role="img" aria-label="Not scheduled" title="Not scheduled" className="shrink-0 text-danger">
              <Icons.warning size={14} />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-fg-2">
          {showPriority && (
            <span data-testid="panel-priority" className="flex shrink-0 items-center gap-1.5"><Dot bucket={bucket} />{GROUP_META[bucket].short}</span>
          )}
          <span className="shrink-0">{due}</span>
          <div data-testid="panel-progress" className="flex min-w-[64px] flex-1 items-center gap-1.5">
            <div className="h-[3px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-fg/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 tabular-nums">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)}</span>
          </div>
        </div>
        {/* Its own line: squeezed in beside the due date it starved the progress bar. */}
        {next && <div data-testid="panel-next" className="mt-0.5 truncate text-[12px] text-fg-3">{next}</div>}
      </div>
      <span className="chip h-6 shrink-0 px-2 text-[11px]">{formatDurationShort(task.durationMs)}</span>
      {/* ✎ and × are adjacent, so they grow by padding, never by a pseudo box: overlapping
          hit areas would let × steal ✎'s taps. The wider gap keeps them apart. Hover-revealed on
          a fine pointer, they float over the duration chip. */}
      <span className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-pill transition-opacity coarse:static coarse:translate-y-0 coarse:gap-2 ${coarse ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'} [background:var(--x-dialog-bg)] coarse:[background:none]`}>
        <button type="button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)} className="rounded-pill p-1 text-fg-2 hover:bg-fg/10 hover:text-fg coarse:p-3">✎</button>
        <button type="button" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task)} className="rounded-pill p-1 text-fg-2 hover:bg-danger/10 hover:text-danger coarse:p-3">×</button>
      </span>
    </div>
  );
}

export function PlannerTaskPanel({ tasks, preview, nowMs, zone, onComplete, onEdit, onDelete, compact = false, coarse = false, tab: tabProp, onTabChange }: PlannerTaskPanelProps) {
  const [tabState, setTabState] = useState<PanelTab>('priorities');
  const tab = tabProp ?? tabState;
  const setTab = (t: PanelTab) => { setTabState(t); onTabChange?.(t); };
  const [expanded, setExpanded] = useState<Partial<Record<BucketKey, boolean>>>({});
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const idBase = useId();

  const active = useMemo(() => tasks.filter(isActiveTask), [tasks]);
  const atRiskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of preview?.unscheduled ?? []) {
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
  const byDue = useMemo(() => sortByDue(active), [active]);

  const card = (t: Task, showPriority: boolean) => (
    <TaskCard
      key={t.id} task={t} nowMs={nowMs} zone={zone} nextMs={nextBlockMsForTask(t.id, preview)}
      atRisk={atRiskIds.has(t.id)} showPriority={showPriority} coarse={coarse}
      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
    />
  );

  // Roving tabs (WAI-ARIA tabs pattern): ←/→ (and Home/End) move selection and focus.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.key === tab);
    let j: number | null = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    const next = TABS[j]!.key;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside
      data-testid="planner-task-panel"
      aria-label="Tasks"
      className={`flex flex-col overflow-hidden ${compact ? 'min-h-0 w-full flex-1' : 'glass min-h-0 w-[330px] flex-1 rounded-panel'}`}
    >
      <div role="tablist" aria-label="Task view" className={`flex shrink-0 gap-1 rounded-pill bg-fg/[.05] p-1 ${compact ? 'mx-1 mb-2' : 'mx-3.5 mt-3.5'}`}>
        {TABS.map((t) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(n) => { tabRefs.current[t.key] = n; }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${idBase}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={onTabKey}
              className={`h-10 flex-1 rounded-pill text-[14px] transition-colors ${selected ? 'bg-fg/[.14] text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'text-fg-2 hover:text-fg'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto ${compact ? 'px-1 pb-2' : 'px-3.5 pb-3.5 pt-4'}`}
      >
        {active.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-fg-2">No active tasks.</p>}

        {tab === 'priorities' && grouped.map((g) => {
          const isExpanded = expanded[g.bucket] === true;
          const { shown, hidden } = splitShown(g.tasks, isExpanded);
          return (
            <section key={g.bucket} aria-label={GROUP_META[g.bucket].label} className="space-y-2">
              <h3 className="flex items-center gap-2 px-1 text-[12.5px] uppercase tracking-[0.1em] text-fg">
                <Dot bucket={g.bucket} />
                {GROUP_META[g.bucket].label}
                <span className="text-fg-2">{g.tasks.length}</span>
              </h3>
              {shown.map((t) => card(t, false))}
              {g.tasks.length > PANEL_GROUP_LIMIT && (
                <button
                  type="button"
                  data-testid={`panel-show-more-${g.bucket}`}
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded((e) => ({ ...e, [g.bucket]: !e[g.bucket] }))}
                  className="btn-glass h-10 w-full rounded-pill text-[14px] text-fg"
                >
                  {isExpanded ? 'Show less' : `Show ${hidden} more`}
                </button>
              )}
            </section>
          );
        })}

        {tab === 'tasks' && (
          <div className="space-y-2">
            {byDue.map((t) => card(t, true))}
          </div>
        )}
      </div>
    </aside>
  );
}
