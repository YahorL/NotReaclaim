import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation } from '../../api/queries';
import { DurationStepper } from '../components/DurationStepper';

const iso = (ms: number): string => new Date(ms).toISOString();
const fmt = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface CreatePopoverProps {
  dayStartMs: number;
  startMin: number;   // snapped minute-of-day for the slot start
  topPct: number;     // vertical anchor within the column (%)
  onClose: () => void;
}

type Mode = 'event' | 'task';

export function CreatePopover({ dayStartMs, startMin, topPct, onClose }: CreatePopoverProps) {
  const [mode, setMode] = useState<Mode>('event');
  const [title, setTitle] = useState('');
  const [durationMs, setDurationMs] = useState(30 * 60_000);
  const ref = useRef<HTMLDivElement>(null);
  const createTaskM = useCreateTaskMutation();
  const createEventM = useCreateCalendarEventMutation();
  const createBlockM = useCreateScheduledBlockMutation();

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
    if (!title.trim() || pending) return;
    if (mode === 'event') {
      createEventM.mutate({ title: title.trim(), startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose });
    } else {
      const dueBy = iso(dayStartMs + (23 * 60 + 59) * 60_000);
      createTaskM.mutate(
        { title: title.trim(), durationMs, minChunkMs: durationMs, maxChunkMs: durationMs, priority: 4, dueBy },
        { onSuccess: (task) => createBlockM.mutate({ taskId: task.id, startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose }) },
      );
    }
  };

  const tabCls = (active: boolean) =>
    `flex-1 rounded-[8px] px-2 py-1 text-[13px] font-bold ${active ? 'bg-indigo text-white' : 'text-inkSoft hover:bg-bg'}`;

  return (
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-1 right-1 z-40 animate-pop rounded-[14px] border border-line bg-card p-3 shadow-pop"
      style={{ top: `${Math.min(topPct, 78)}%` }}
    >
      <div className="mb-2 flex gap-1 rounded-[10px] bg-bg p-1">
        <button type="button" data-testid="mode-event" onClick={() => setMode('event')} className={tabCls(mode === 'event')}>Event</button>
        <button type="button" data-testid="mode-task" onClick={() => setMode('task')} className={tabCls(mode === 'task')}>Task</button>
      </div>
      <input
        autoFocus
        data-testid="create-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={mode === 'event' ? 'Event name…' : 'Task name…'}
        className="mb-2 w-full rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5 text-[14px] font-semibold outline-none focus:border-indigo"
      />
      <div className="mb-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5">
        <DurationStepper label="slot" size={20} valueMs={durationMs} onChange={setDurationMs} />
      </div>
      <p data-testid="slot-label" className="mb-2 text-[12px] font-semibold text-inkSoft">{fmt(startMs)} – {fmt(endMs)}</p>
      {apiError && <p data-testid="create-error" className="mb-2 text-[11px] text-crit">{apiError.message}</p>}
      <button
        type="button"
        data-testid="create-submit"
        disabled={!title.trim() || pending}
        onClick={submit}
        className="w-full rounded-[20px] bg-indigo py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
      >
        Create {mode === 'event' ? 'event' : 'task'}
      </button>
    </div>
  );
}
