import type { ScheduledBlock } from '../../api/types';
import { useScheduleQuery } from '../../api/queries';
import { Icons } from '../shell/icons';
import { useNowNextControls } from '../shell/useNowNextControls';
import { useTimezone } from '../settings/useTimezone';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';
import { formatDurationShort, untilLabel } from '../lib/duration';

/** The scheduled block that starts soonest after `ref` (any task or habit block), or null. */
export function followingBlock(blocks: readonly ScheduledBlock[], ref: ScheduledBlock): ScheduledBlock | null {
  const refStart = Date.parse(ref.startsAt);
  return blocks
    .filter((b) => b.id !== ref.id && Date.parse(b.startsAt) > refStart)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

const ACTION = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold';

/**
 * The planner's Next-up card (spec §4.2 / D7): what you are working on now (with Stop) or the next
 * task block (with Start), plus the block after it. Same current-or-next selection as the header
 * pill, which the TopBar hides on the planner route.
 */
export function NextUpCard({ now = Date.now, className = '' }: { now?: () => number; className?: string }) {
  const { running, nextBlock, start, stop } = useNowNextControls(now);
  const scheduleQ = useScheduleQuery();
  const zone = useTimezone();
  const nowMs = now();
  const current = running ?? nextBlock;
  const following = current ? followingBlock(scheduleQ.data ?? [], current) : null;

  return (
    <section data-testid="next-up-card" aria-label="Next up" className={`glass flex min-w-0 flex-col justify-center gap-1.5 rounded-panel px-6 py-5 ${className}`}>
      {current === null ? (
        <>
          <span className="text-[14px] text-fg-2">Next up</span>
          <span className="text-[17px] text-fg-2">Nothing scheduled next</span>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[14px] text-fg-2">
              {running
                ? <>Now · until {relativeDayTimeLabel(Date.parse(running.endsAt), nowMs, zone).replace(/^Today /, '')}</>
                : <>Next up · {relativeDayTimeLabel(Date.parse(current.startsAt), nowMs, zone)}</>}
            </span>
            <span className="chip shrink-0 border-accent-line text-accent-fg">
              {running
                ? `${formatDurationShort(Math.max(0, Date.parse(running.endsAt) - nowMs))} left`
                : untilLabel(Date.parse(current.startsAt), nowMs)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span
              data-testid={running ? 'current-task' : 'next-task'}
              className="min-w-0 truncate text-[24px] font-medium leading-tight tracking-[-0.01em] text-fg"
            >
              {current.title}
            </span>
            {running ? (
              <button type="button" data-testid="stop-task" onClick={stop} className={`btn-glass ${ACTION} text-danger`}>
                <Icons.stop size={14} /> Stop
              </button>
            ) : (
              <button type="button" data-testid="next-task-start" onClick={start} className={`btn-accent ${ACTION}`}>
                <Icons.play size={14} /> Start
              </button>
            )}
          </div>
          {following && (
            <span data-testid="next-up-following" className="min-w-0 truncate text-[13px] text-fg-2">
              {relativeDayTimeLabel(Date.parse(following.startsAt), nowMs, zone)} · <span className="font-medium text-fg">{following.title}</span>
            </span>
          )}
        </>
      )}
    </section>
  );
}
