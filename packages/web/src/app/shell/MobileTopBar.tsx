import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { Icons } from './icons';
import { ActionIcon } from './ActionIcon';
import { routeTitle } from './routeHeader';
import { useNowNextControls } from './useNowNextControls';

interface MobileTopBarProps {
  onNewTask: () => void;
  now?: () => number;
}

const PILL = 'glass-card min-w-0 truncate rounded-pill px-3 py-1.5 text-[13px] text-fg-2';
const ACTION = 'inline-flex shrink-0 items-center gap-1 rounded-pill px-3 py-1.5 text-[13px] font-semibold coarse:py-2.5';

/**
 * ~56px glass chrome for phones: page title, a truncated one-line Now/Next pill with its
 * Start/Stop button, and a `+` that opens NewTaskModal. Search and the avatar menu are
 * dropped here — sign-out lives in a Settings row on mobile, and the search palette is reachable
 * from a hardware keyboard (`/`, Ctrl/Cmd+K). Hidden at md+, where the full TopBar takes over.
 */
export function MobileTopBar({ onNewTask, now = Date.now }: MobileTopBarProps): ReactElement {
  const { pathname } = useLocation();
  const { running, nextBlock, nextLabel, start, stop, openPlanner, startPending, stopPending, startNextBlock, startNextLabel, startNextPending, startNext } = useNowNextControls(now);

  return (
    <header
      data-testid="mobile-top-bar"
      className="glass flex h-14 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-3 md:hidden"
    >
      <h1 className="shrink-0 text-[19px] font-semibold tracking-[-.3px] text-fg">{routeTitle(pathname)}</h1>

      {running ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button type="button" data-testid="mobile-current-task" onClick={openPlanner} className={PILL}>
            <span className="font-medium text-fg">Now</span> · {running.title}
          </button>
          <button type="button" data-testid="mobile-stop-task" onClick={stop} aria-busy={stopPending || undefined} className={`btn-glass ${ACTION} text-danger`}>
            <ActionIcon pending={stopPending} icon={Icons.stop} size={13} /> Stop
          </button>
          {startNextBlock && (
            <button
              type="button"
              data-testid="mobile-start-next"
              aria-label={startNextLabel ?? undefined}
              onClick={startNext}
              aria-busy={startNextPending || undefined}
              className="btn-glass inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-fg coarse:p-2.5"
            >
              <ActionIcon pending={startNextPending} icon={Icons.play} size={13} />
            </button>
          )}
        </div>
      ) : nextBlock ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button type="button" data-testid="mobile-next-task" onClick={openPlanner} className={PILL}>
            {nextLabel}
          </button>
          <button type="button" data-testid="mobile-next-task-start" onClick={start} aria-busy={startPending || undefined} className={`btn-accent ${ACTION}`}>
            <ActionIcon pending={startPending} icon={Icons.play} size={13} /> Start
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
        className="btn-primary shrink-0 rounded-full p-2 coarse:p-3"
      >
        <Icons.plus size={20} />
      </button>
    </header>
  );
}
