import { useLocation } from 'react-router-dom';
import { Icons } from './icons';
import { routeHeader } from './routeHeader';
import { AccountMenu } from './AccountMenu';
import { useNowNextControls } from './useNowNextControls';
import { useTasksQuery } from '../../api/queries';
import { useTimezone } from '../settings/useTimezone';
import { isActiveTask } from '../priorities/priorityBucket';

interface TopBarProps {
  onNewTask: () => void;
  /** Opens the task search palette. The button is disabled without it. */
  onSearch?: () => void;
  now?: () => number;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}

/** 46px round glass icon button (prototype `.gbtn` header buttons). */
const ROUND_GLASS = 'btn-glass flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full';

export function TopBar({ onNewTask, onSearch, now = Date.now, sidebarHidden, onToggleSidebar }: TopBarProps) {
  const { pathname } = useLocation();
  const { running, nextBlock, nextLabel, start, stop, openPlanner } = useNowNextControls(now);
  const zone = useTimezone();
  const tasksQ = useTasksQuery();
  const openTaskCount = tasksQ.data ? tasksQ.data.filter(isActiveTask).length : null;
  const { eyebrow, title: [before, bold, after] } = routeHeader(pathname, { nowMs: now(), zone, openTaskCount });

  return (
    <header className="hidden shrink-0 flex-wrap items-end justify-between gap-4 px-1 pt-1.5 md:flex">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <span data-testid="route-eyebrow" className="text-[14px] tracking-[0.02em] text-fg-2">{eyebrow}</span>}
        <h1 className="text-[48px] font-light leading-none tracking-[-0.02em] text-fg">
          {before}<strong className="font-medium">{bold}</strong>{after}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {onToggleSidebar && (
          <button
            type="button"
            data-testid="toggle-sidebar"
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!sidebarHidden}
            onClick={onToggleSidebar}
            className={ROUND_GLASS}
          >
            <Icons.panelLeft size={20} />
          </button>
        )}

        {running && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="current-task"
              onClick={openPlanner}
              className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-fg-2 hover:bg-line"
            >
              <Icons.clock size={16} />
              Now: {running.title}
            </button>
            <button
              type="button"
              data-testid="stop-task"
              onClick={stop}
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
              onClick={openPlanner}
              className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-fg-2 hover:bg-line"
            >
              <Icons.clock size={16} />
              {nextLabel}
            </button>
            <button
              type="button"
              data-testid="next-task-start"
              onClick={start}
              className="rounded-[9px] bg-indigo px-3 py-2 text-[13px] font-bold text-white hover:bg-indigo600"
            >
              Start
            </button>
          </div>
        )}

        <button
          type="button"
          aria-label="Search tasks"
          aria-keyshortcuts="/ Control+K Meta+K"
          aria-haspopup="dialog"
          disabled={!onSearch}
          onClick={onSearch}
          className={ROUND_GLASS}
        >
          <Icons.search size={20} />
        </button>

        <button
          type="button"
          onClick={onNewTask}
          aria-haspopup="dialog"
          className="btn-primary inline-flex h-[46px] shrink-0 items-center gap-2 rounded-pill pl-4 pr-5 text-[15px] font-medium shadow-[inset_0_1px_0_#fff,0_10px_30px_-12px_rgba(255,255,255,0.5)] [[data-theme=light]_&]:shadow-[0_10px_30px_-12px_rgba(17,18,20,0.55)]"
        >
          <Icons.plus size={18} className="[stroke-width:2]" /> New task
        </button>

        <AccountMenu />
      </div>
    </header>
  );
}
