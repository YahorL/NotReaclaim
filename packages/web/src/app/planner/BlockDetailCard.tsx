import { useEffect, useRef } from 'react';
import type { CalendarEvent, Task } from '../../api/types';
import { Icons } from '../shell/icons';
import { formatDurationShort } from '../lib/duration';
import { blockVariant, type BlockKind } from './blockStyle';
import { dueLabel, priorityToBucket } from '../priorities/priorityBucket';

/** Everything the card shows about the selected block, resolved by the Planner. */
export interface BlockDetail {
  key: string;
  kind: BlockKind;
  source: 'app' | 'google' | null;
  title: string;
  startMs: number;
  endMs: number;
  pinned: boolean;
  started: boolean;
  /** Being worked on now by the tracking mode's rule (isRunningBlock) — Stop applies. */
  running: boolean;
  taskId: string | null;
  event: CalendarEvent | null;
}

export interface BlockDetailCardProps {
  detail: BlockDetail;
  zone: string;
  /** The block's task, for the priority / due / progress extras. */
  task?: Task | null;
  /** Move focus to the heading on open (the selection came from the keyboard). */
  autoFocus?: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenHabits: () => void;
  onUnpin?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  className?: string;
}

const PRIORITY: Record<ReturnType<typeof priorityToBucket>, { label: string; dot: string }> = {
  critical: { label: 'Critical', dot: 'text-pri-crit' },
  high: { label: 'High priority', dot: 'text-pri-high' },
  medium: { label: 'Medium priority', dot: 'text-pri-med' },
  low: { label: 'Low priority', dot: 'text-pri-low' },
};

const time = (ms: number, zone: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(ms);
const longDay = (ms: number, zone: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: zone }).format(ms);

const ACTION = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-pill px-4 text-[14px] font-medium';

/**
 * Detail card for the selected planner block (spec §5.4), shown atop the side column. The primary
 * action opens the existing editor (TaskDrawer / EventDrawer) or the Habits page; Google meetings
 * have none — they are read-only here. One secondary action per the §3 matrix: Stop for a running
 * block, Unpin for a pinned one, else Delete. Google meetings get no secondary action.
 */
export function BlockDetailCard({
  detail, zone, task = null, autoFocus = false, onClose, onOpenTask, onOpenEvent, onOpenHabits, onUnpin, onStop, onDelete, className = '',
}: BlockDetailCardProps) {
  // A piece running without a Start (automatic tracking) is in progress too.
  const v = blockVariant({ kind: detail.kind, source: detail.source, pinned: detail.pinned, started: detail.started || detail.running });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus({ preventScroll: true });
  }, [autoFocus, detail.key]);

  const isEvent = detail.event !== null;
  const isHabit = !isEvent && detail.taskId === null;
  const secondary = v.locked
    ? null
    : detail.running && onStop
      ? { label: 'Stop', testId: 'detail-stop', icon: <Icons.stop size={14} />, run: onStop, danger: true }
      : detail.pinned && onUnpin
        ? { label: 'Unpin', testId: 'detail-unpin', icon: <Icons.pin size={14} />, run: onUnpin, danger: false }
        : onDelete
          ? { label: 'Delete', testId: 'detail-delete', icon: <Icons.close size={14} />, run: onDelete, danger: true }
          : null;
  const bucket = task ? priorityToBucket(task.priority) : null;
  const spent = task?.spentMs ?? 0;

  return (
    <section
      data-testid="block-detail-card"
      data-kind={detail.kind}
      data-locked={v.locked}
      aria-labelledby="block-detail-title"
      className={`glass flex shrink-0 flex-col gap-4 rounded-panel p-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span data-testid="detail-chip" className="chip">
          {v.icon === 'lock' && <Icons.lock size={12} />}
          {v.icon === 'pin' && <Icons.pin size={12} />}
          {v.chip}
        </span>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="btn-glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        >
          <Icons.close size={16} />
        </button>
      </div>

      <div>
        <h2 id="block-detail-title" ref={headingRef} tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.01em] text-fg outline-none [overflow-wrap:anywhere]">
          {detail.title}
        </h2>
        <p className="mt-1 text-[14px] text-fg-2">{longDay(detail.startMs, zone)}</p>
      </div>

      {/* The time range gets the wider tile so "12:45 PM – 10:15 PM" stays on one line. */}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2.5">
        <div className="glass-card rounded-card px-3.5 py-2.5">
          <div className="text-[12px] text-fg-2">Time</div>
          <div data-testid="detail-time" className="mt-0.5 whitespace-nowrap text-[14px] font-medium tabular-nums text-fg">{time(detail.startMs, zone)} – {time(detail.endMs, zone)}</div>
        </div>
        <div className="glass-card rounded-card px-3.5 py-2.5">
          <div className="text-[12px] text-fg-2">Duration</div>
          <div data-testid="detail-duration" className="mt-0.5 text-[14px] font-medium tabular-nums text-fg">{formatDurationShort(detail.endMs - detail.startMs)}</div>
        </div>
      </div>

      {task && bucket && (
        <div data-testid="detail-task-extras" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-current shadow-[0_0_8px_currentColor] ${PRIORITY[bucket].dot}`} />
            {PRIORITY[bucket].label}
          </span>
          <span>{dueLabel(task.dueBy, zone) ?? 'No deadline'}</span>
          <span className="tabular-nums">{formatDurationShort(spent)} spent · {formatDurationShort(Math.max(0, task.durationMs - spent))} left</span>
        </div>
      )}

      {v.locked && <p className="text-[13px] text-fg-2">Synced from Google Calendar — edit it there.</p>}

      {(!v.locked || secondary) && (
        <div className="flex flex-wrap gap-2">
          {!v.locked && (
            isEvent ? (
              <button type="button" data-testid="detail-open" onClick={() => onOpenEvent(detail.event!)} className={`btn-accent ${ACTION}`}>Open event</button>
            ) : isHabit ? (
              <button type="button" data-testid="detail-open" onClick={onOpenHabits} className={`btn-accent ${ACTION}`}>Open habits</button>
            ) : (
              <button type="button" data-testid="detail-open" onClick={() => onOpenTask(detail.taskId!)} className={`btn-accent ${ACTION}`}>Open task</button>
            )
          )}
          {secondary && (
            <button type="button" data-testid={secondary.testId} onClick={secondary.run} className={`btn-glass ${ACTION} ${secondary.danger ? 'text-danger' : ''}`}>
              {secondary.icon} {secondary.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
