import { useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { AccountMenu } from './AccountMenu';
import { useStartBlockMutation, useStopBlockMutation } from '../../api/queries';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';
import { useCurrentOrNext } from './currentOrNext';

interface TopBarProps {
  onNewTask: () => void;
  now?: () => number;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}

export function TopBar({ onNewTask, now = Date.now, sidebarHidden, onToggleSidebar }: TopBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();
  const { running, nextBlock } = useCurrentOrNext(nowMs);

  return (
    <header className="hidden h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px] md:flex">
      {onToggleSidebar && (
        <button
          type="button"
          data-testid="toggle-sidebar"
          aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          onClick={onToggleSidebar}
          className="rounded-[9px] p-2 text-inkSoft hover:bg-line hover:text-ink"
        >
          <Icons.panelLeft size={20} />
        </button>
      )}
      <h1 className="flex-1 text-[27px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

      {running && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="current-task"
            onClick={() => void navigate('/')}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-ink/70 hover:bg-line"
          >
            <Icons.clock size={16} />
            Now: {running.title}
          </button>
          <button
            type="button"
            data-testid="stop-task"
            onClick={() => stopBlock.mutate(running.id)}
            className="rounded-[9px] bg-crit px-3 py-2 text-[13px] font-bold text-white hover:opacity-90"
          >
            Stop
          </button>
        </div>
      )}

      {nextBlock && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="next-task"
            onClick={() => void navigate('/')}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-ink/70 hover:bg-line"
          >
            <Icons.clock size={16} />
            Next: {nextBlock.title} · {relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs)}
          </button>
          <button
            type="button"
            data-testid="next-task-start"
            onClick={() => startBlock.mutate(nextBlock.id)}
            className="rounded-[9px] bg-indigo px-3 py-2 text-[13px] font-bold text-white hover:bg-indigo600"
          >
            Start
          </button>
        </div>
      )}

      <button type="button" onClick={onNewTask} className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[15.5px] font-bold text-ink hover:bg-line">
        <Icons.plus size={18} /> New Task
      </button>

      <button type="button" aria-label="Search (coming soon)" disabled className="cursor-not-allowed rounded-[9px] p-2 text-inkSoft/50">
        <Icons.search size={20} />
      </button>

      <AccountMenu />
    </header>
  );
}
