import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery } from '../../api/queries';
import { DurationStepper } from '../components/DurationStepper';
import { WINDOW_END_MIN } from './weekModel';

const iso = (ms: number): string => new Date(ms).toISOString();
const fmt = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface CreatePopoverProps {
  dayStartMs: number;
  startMin: number;   // snapped minute-of-day for the slot start
  topPct: number;     // vertical anchor within the column (%)
  onClose: () => void;
  align?: 'left' | 'right';
}

type Mode = 'event' | 'task';

export function CreatePopover({ dayStartMs, startMin, topPct, onClose, align = 'left' }: CreatePopoverProps) {
  const [mode, setMode] = useState<Mode>('event');
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const maxDurationMs = (WINDOW_END_MIN - startMin) * 60_000;
  const [durationMs, setDurationMs] = useState(Math.min(30 * 60_000, maxDurationMs));
  const ref = useRef<HTMLDivElement>(null);
  const createTaskM = useCreateTaskMutation();
  const createEventM = useCreateCalendarEventMutation();
  const createBlockM = useCreateScheduledBlockMutation();
  const tasksQ = useTasksQuery();
  const activeTasks = (tasksQ.data ?? []).filter((t) => t.status === 'pending' || t.status === 'scheduled');
  const existingChosen = mode === 'task' && taskId !== '';

  const startMs = dayStartMs + startMin * 60_000;
  const endMs = startMs + durationMs;
  const pending = createTaskM.isPending || createEventM.isPending || createBlockM.isPending;
  const apiError = [createTaskM.error, createEventM.error, createBlockM.error].find((e) => e instanceof ApiError) as ApiError | undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const submit = () => {
    if (pending || (!existingChosen && !title.trim())) return;
    if (mode === 'event') {
      createEventM.mutate({ title: title.trim(), startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose });
    } else if (existingChosen) {
      createBlockM.mutate({ taskId, startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose });
    } else {
      const dueBy = iso(dayStartMs + (23 * 60 + 59) * 60_000);
      createTaskM.mutate(
        { title: title.trim(), durationMs, minChunkMs: durationMs, maxChunkMs: durationMs, priority: 4, dueBy },
        { onSuccess: (task) => createBlockM.mutate({ taskId: task.id, startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose }) },
      );
    }
  };

  const tabCls = (active: boolean) =>
    `flex-1 rounded-[8px] px-2 py-1.5 text-[14px] font-bold ${active ? 'bg-indigo text-white' : 'text-inkSoft hover:bg-bg'}`;

  return (
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 w-[340px] animate-pop rounded-[14px] border border-line bg-card p-4 shadow-pop ${align === 'left' ? 'left-1' : 'right-1'}`}
      style={{ top: `${Math.min(topPct, 78)}%` }}
    >
      <div className="mb-2 flex gap-1 rounded-[10px] bg-bg p-1">
        <button type="button" data-testid="mode-event" onClick={() => { setMode('event'); setTaskId(''); }} className={tabCls(mode === 'event')}>Event</button>
        <button type="button" data-testid="mode-task" onClick={() => setMode('task')} className={tabCls(mode === 'task')}>Task</button>
      </div>
      {mode === 'task' && (
        <select
          data-testid="task-select"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="mb-2 w-full rounded-[9px] border-[1.5px] border-line bg-card px-3 py-2 text-[15px] font-semibold outline-none focus:border-indigo"
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
          placeholder={mode === 'event' ? 'Event name…' : 'Task name…'}
          className="mb-2 w-full rounded-[9px] border-[1.5px] border-line px-3 py-2 text-[15px] font-semibold outline-none focus:border-indigo"
        />
      )}
      <div className="mb-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5">
        <DurationStepper label="slot" size={22} valueMs={durationMs} onChange={(ms) => setDurationMs(Math.max(15 * 60_000, Math.min(ms, maxDurationMs)))} />
      </div>
      <p data-testid="slot-label" className="mb-2 text-[13px] font-semibold text-inkSoft">{fmt(startMs)} – {fmt(endMs)}</p>
      {apiError && <p data-testid="create-error" className="mb-2 text-[11px] text-crit">{apiError.message}</p>}
      <button
        type="button"
        data-testid="create-submit"
        disabled={(!existingChosen && !title.trim()) || pending}
        onClick={submit}
        className="w-full rounded-[20px] bg-indigo py-2 text-[14px] font-bold text-white disabled:opacity-50"
      >
        {mode === 'event' ? 'Create event' : existingChosen ? 'Schedule task' : 'Create task'}
      </button>
    </div>
  );
}
