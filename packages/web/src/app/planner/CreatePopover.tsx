import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useCategoriesQuery } from '../../api/queries';
import { DurationStepper } from '../components/DurationStepper';
import { WINDOW_END_MIN, SLOT_MIN, formatHm } from './weekModel';
import { MS_PER_MIN, toIso } from '../lib/time';
import { dateFieldToIso, defaultDueLocal } from '../tasks/taskForm';
import { useZoneChange } from '../settings/useTimezone';
import { isActiveTask } from '../priorities/priorityBucket';

export interface CreatePopoverProps {
  dayStartMs: number;
  startMin: number;   // snapped minute-of-day for the slot start
  topPct: number;     // vertical anchor within the column (%)
  onClose: () => void;
  align?: 'left' | 'right';
  now?: () => number;
  /** Settings zone the slot label and the date fields are read in. */
  zone: string;
  /**
   * Below md: render as plain form content — the host `Sheet` owns the chrome, the backdrop,
   * Escape and dismissal. Off, this is the column-anchored desktop popover.
   */
  compact?: boolean;
}

type Mode = 'event' | 'task' | 'blocked';

/** Blocked time is about the slot, not the label — an untitled entry just reads "Blocked". */
const DEFAULT_BLOCKED_TITLE = 'Blocked';

export function CreatePopover({ dayStartMs, startMin, topPct, onClose, align = 'left', now = () => Date.now(), zone, compact = false }: CreatePopoverProps) {
  const [mode, setMode] = useState<Mode>('event');
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const maxDurationMs = (WINDOW_END_MIN - startMin) * MS_PER_MIN;
  const [durationMs, setDurationMs] = useState(Math.min(30 * MS_PER_MIN, maxDurationMs));
  const startMs = dayStartMs + startMin * MS_PER_MIN;
  // Same default as the New Task modal (+7 days, 23:59, settings zone) — but never before the
  // day of the slot the task is being pinned to.
  const [dueLocal, setDueLocal] = useState(() => defaultDueLocal(now(), zone, startMs));
  // The default actually seeded, kept rather than rebuilt: the clock may have crossed midnight and
  // the slot (`startMs`) moves with the zone, so a rebuilt "previous seed" would no longer match.
  const seededDueRef = useRef<string | null>(null);
  if (seededDueRef.current === null) seededDueRef.current = dueLocal;
  // Opened before settings loaded (fallback zone): re-seed the default unless the user edited it.
  useZoneChange(zone, (_prev, next) => {
    const prevSeed = seededDueRef.current;
    const nextSeed = defaultDueLocal(now(), next, startMs);
    seededDueRef.current = nextSeed;
    setDueLocal((cur) => (cur === prevSeed ? nextSeed : cur));
  });
  const [afterLocal, setAfterLocal] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const createTaskM = useCreateTaskMutation();
  const createEventM = useCreateCalendarEventMutation();
  const createBlockM = useCreateScheduledBlockMutation();
  const tasksQ = useTasksQuery();
  const categoriesQ = useCategoriesQuery();
  const categories = categoriesQ.data ?? [];
  const activeTasks = (tasksQ.data ?? []).filter(isActiveTask);
  const existingChosen = mode === 'task' && taskId !== '';
  const showNewTaskFields = mode === 'task' && !existingChosen;
  const titleOptional = mode === 'blocked';

  // Mirror NewTaskModal: default-select the isDefault category once categories load
  useEffect(() => {
    if (categoryId === null && categories.length > 0) {
      const def = categories.find((c) => c.isDefault) ?? categories[0]!;
      setCategoryId(def.id);
    }
  }, [categories, categoryId]);

  const endMs = startMs + durationMs;
  const pending = createTaskM.isPending || createEventM.isPending || createBlockM.isPending;
  const hasTitle = titleOptional || existingChosen || title.trim() !== '';
  // The popover's due date is required (a pinned new task needs one), so empty is not "no value"
  // here. Schedule after is optional: empty → none, but a typed value that does not convert in the
  // zone blocks Create rather than silently creating the task without it.
  const dueIso = dateFieldToIso(dueLocal, zone);
  const afterIso = dateFieldToIso(afterLocal, zone);
  const datesOk = !showNewTaskFields || (typeof dueIso === 'string' && afterIso !== undefined);
  const canSubmit = !pending && hasTitle && datesOk;
  const apiError = [createTaskM.error, createEventM.error, createBlockM.error].find((e) => e instanceof ApiError) as ApiError | undefined;

  useEffect(() => {
    // Inside the compact sheet the Sheet owns dismissal (backdrop tap, ✕, Escape). A second
    // outside-dismiss here would fire on POINTERDOWN and unmount the form before the tap's
    // click — which would then land on the day column underneath and re-open the form at
    // another slot. That is exactly the "I can't close it" report this sheet fixes.
    if (compact) return;
    // A surface above the popover (the search palette) that already handled Escape keeps it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [onClose, compact]);

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'blocked') {
      createEventM.mutate(
        { title: title.trim() || DEFAULT_BLOCKED_TITLE, startsAt: toIso(startMs), endsAt: toIso(endMs), kind: 'blocked' },
        { onSuccess: onClose },
      );
    } else if (mode === 'event') {
      createEventM.mutate({ title: title.trim(), startsAt: toIso(startMs), endsAt: toIso(endMs) }, { onSuccess: onClose });
    } else if (existingChosen) {
      createBlockM.mutate({ taskId, startsAt: toIso(startMs), endsAt: toIso(endMs) }, { onSuccess: onClose });
    } else {
      // Only the new-task branch gets here, and `canSubmit` requires both dates to convert for it.
      if (typeof dueIso !== 'string' || afterIso === undefined) return;
      const dueBy = dueIso;
      const notBefore = afterIso ?? undefined;
      const catId = categoryId ?? undefined;
      createTaskM.mutate(
        {
          title: title.trim(), durationMs, minChunkMs: durationMs, maxChunkMs: durationMs, priority: 4, dueBy,
          ...(notBefore !== undefined && { notBefore }),
          ...(catId !== undefined && { categoryId: catId }),
        },
        { onSuccess: (task) => createBlockM.mutate({ taskId: task.id, startsAt: toIso(startMs), endsAt: toIso(endMs) }, { onSuccess: onClose }) },
      );
    }
  };

  const tabCls = (active: boolean) =>
    `h-9 flex-1 rounded-pill px-2 text-[14px] transition-colors ${active ? 'bg-fg/[.14] text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'text-fg-2 hover:text-fg'}`;

  return (
    // Compact: plain content inside a `Sheet` — the sheet supplies the backdrop, the ✕, Escape,
    // the z-50 tier and the scroll. Desktop keeps the column-anchored popover.
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className={compact
        ? 'p-2'
        : `glass-dialog pointer-events-auto absolute z-40 w-[340px] animate-pop rounded-panel p-4 ${align === 'left' ? 'left-1' : 'right-1'}`}
      style={compact ? undefined : { top: `${Math.min(topPct, 78)}%` }}
    >
      <div role="group" aria-label="Entry type" className="mb-3 flex gap-1 rounded-pill bg-fg/[.05] p-1">
        <button type="button" data-testid="mode-event" aria-pressed={mode === 'event'} onClick={() => { setMode('event'); setTaskId(''); }} className={tabCls(mode === 'event')}>Event</button>
        <button type="button" data-testid="mode-task" aria-pressed={mode === 'task'} onClick={() => setMode('task')} className={tabCls(mode === 'task')}>Task</button>
        <button type="button" data-testid="mode-blocked" aria-pressed={mode === 'blocked'} onClick={() => { setMode('blocked'); setTaskId(''); }} className={tabCls(mode === 'blocked')}>Blocked</button>
      </div>
      {mode === 'task' && (
        <select
          data-testid="task-select"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="mb-2 h-10 w-full px-3 text-[15px] rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors focus:border-focus"
        >
          <option value="">➕ New task</option>
          {activeTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
      {!existingChosen && (
        <input
          autoFocus
          data-testid="create-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={mode === 'event' ? 'Event name…' : mode === 'blocked' ? 'Blocked (optional)…' : 'Task name…'}
          className="mb-2 h-10 w-full px-3 text-[15px] font-medium rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors focus:border-focus placeholder:text-fg-3"
        />
      )}
      {showNewTaskFields && (
        <>
          <div className="mb-2">
            <label className="mb-1 block text-[12px] text-fg-2">Due date</label>
            <input
              type="datetime-local"
              data-testid="create-due"
              required
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="h-9 w-full px-3 text-[13px] rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors focus:border-focus"
            />
            {dueIso === undefined && <p data-testid="create-due-error" className="mt-0.5 text-[11px] text-danger">Enter a valid due date</p>}
          </div>
          <div className="mb-2">
            <label className="mb-1 block text-[12px] text-fg-2">Hours</label>
            <select
              data-testid="create-category"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
              className="h-9 w-full px-3 text-[13px] rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors focus:border-focus"
            >
              <option value="">— none —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="mb-2">
            <label className="mb-1 block text-[12px] text-fg-2">Schedule after</label>
            <input
              type="datetime-local"
              data-testid="create-after"
              value={afterLocal}
              onChange={(e) => setAfterLocal(e.target.value)}
              className="h-9 w-full px-3 text-[13px] rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors focus:border-focus"
            />
            {afterIso === undefined && <p data-testid="create-after-error" className="mt-0.5 text-[11px] text-danger">Enter a valid date or leave it empty</p>}
          </div>
        </>
      )}
      <div className="mb-1.5 rounded-input border border-fg/10 px-2.5 py-1.5">
        <DurationStepper label="slot" size={22} valueMs={durationMs} onChange={(ms) => setDurationMs(Math.max(SLOT_MIN * MS_PER_MIN, Math.min(ms, maxDurationMs)))} />
      </div>
      <p data-testid="slot-label" className="mb-3 text-[13px] tabular-nums text-fg-2">{formatHm(startMs, zone)} – {formatHm(endMs, zone)}</p>
      {apiError && <p data-testid="create-error" className="mb-2 text-[11px] text-danger">{apiError.message}</p>}
      <button
        type="button"
        data-testid="create-submit"
        disabled={!canSubmit}
        onClick={submit}
        className="btn-accent h-10 w-full rounded-pill text-[14px] font-semibold"
      >
        {mode === 'blocked' ? 'Block time' : mode === 'event' ? 'Create event' : existingChosen ? 'Schedule task' : 'Create task'}
      </button>
    </div>
  );
}
