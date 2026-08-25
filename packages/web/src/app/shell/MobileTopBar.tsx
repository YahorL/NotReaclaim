import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { useCurrentOrNext } from './currentOrNext';
import { useStartBlockMutation, useStopBlockMutation } from '../../api/queries';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';

interface MobileTopBarProps {
  onNewTask: () => void;
  now?: () => number;
}

/**
 * ~56px chrome for phones: page title, a truncated one-line Now/Next pill with its
 * Start/Stop button, and a `+` that opens NewTaskModal. Search and the avatar menu are
 * dropped here — sign-out lives in a Settings row on mobile. Hidden at md+, where the
 * full TopBar takes over.
 */
export function MobileTopBar({ onNewTask, now = Date.now }: MobileTopBarProps): ReactElement {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();
  const { running, nextBlock } = useCurrentOrNext(nowMs);

  return (
    <header data-testid="mobile-top-bar" className="flex h-14 shrink-0 items-center gap-2 bg-bg px-3 md:hidden">
      <h1 className="shrink-0 text-[19px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

      {running ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="mobile-current-task"
            onClick={() => void navigate('/')}
            className="min-w-0 truncate rounded-[9px] bg-card px-2.5 py-1.5 text-[13px] font-semibold text-ink/70"
          >
            Now: {running.title}
          </button>
          <button
            type="button"
            data-testid="mobile-stop-task"
            onClick={() => stopBlock.mutate(running.id)}
            className="shrink-0 rounded-[9px] bg-crit px-3 py-1.5 text-[13px] font-bold text-white"
          >
            Stop
          </button>
        </div>
      ) : nextBlock ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="mobile-next-task"
            onClick={() => void navigate('/')}
            className="min-w-0 truncate rounded-[9px] bg-card px-2.5 py-1.5 text-[13px] font-semibold text-ink/70"
          >
            Next: {nextBlock.title} · {relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs)}
          </button>
          <button
            type="button"
            data-testid="mobile-next-task-start"
            onClick={() => startBlock.mutate(nextBlock.id)}
            className="shrink-0 rounded-[9px] bg-indigo px-3 py-1.5 text-[13px] font-bold text-white"
          >
            Start
          </button>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <button
        type="button"
        data-testid="mobile-new-task"
        aria-label="New task"
        onClick={onNewTask}
        className="shrink-0 rounded-[9px] p-2 text-ink"
      >
        <Icons.plus size={22} />
      </button>
    </header>
  );
}
