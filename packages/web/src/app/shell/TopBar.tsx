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
/** The compact Now/Next pill (non-planner routes; the Planner has its Next-up card). */
const PILL_LABEL = 'flex h-[34px] min-w-0 items-center gap-1.5 rounded-pill px-3 text-[14px] text-fg-2 transition-colors hover:bg-fg/[.06]';
const PILL_ACTION = 'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold';

export function TopBar({ onNewTask, onSearch, now = Date.now, sidebarHidden, onToggleSidebar }: TopBarProps) {
  const { pathname } = useLocation();
  const { running, nextBlock, nextTime, start, stop, openPlanner } = useNowNextControls(now);
  const zone = useTimezone();
  const tasksQ = useTasksQuery();
  const openTaskCount = tasksQ.data ? tasksQ.data.filter(isActiveTask).length : null;
  const { eyebrow, title: [before, bold, after] } = routeHeader(pathname, { nowMs: now(), zone, openTaskCount });
  const onPlanner = pathname === '/';

  return (
    <header className="hidden shrink-0 flex-wrap items-end justify-between gap-4 px-1 pt-1.5 md:flex">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <span data-testid="route-eyebrow" className="text-[14px] tracking-[0.02em] text-fg-2">{eyebrow}</span>}
        <h1 className="text-[48px] font-light leading-none tracking-[-0.02em] text-fg">
          {before}<strong className="font-medium">{bold}</strong>{after}
        </h1>
      </div>

      {/* The cluster never wraps internally (that once left the avatar alone on a row at ~900px).
          When it does not fit beside the title, the header's flex-wrap moves it to its own row as
          one unit, right-aligned (ml-auto), where the pill title can still truncate (min-w-0).
          Below xl it also slims down: New task becomes a round icon button and the pill drops its
          time, so most tablet widths keep a single row. */}
      <div data-testid="header-actions" className="ml-auto flex min-w-0 max-w-full flex-nowrap items-center gap-2.5">
        {onToggleSidebar && (
          <button
            type="button"
            data-testid="toggle-sidebar"
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            onClick={onToggleSidebar}
            className={ROUND_GLASS}
          >
            <Icons.panelLeft size={20} />
          </button>
        )}

        {/* The planner shows its own Next-up card (with Start/Stop) instead of this pill. */}
        {onPlanner ? null : running ? (
          <div data-testid="now-next-pill" className="glass-card flex h-[46px] min-w-0 items-center gap-1 rounded-pill p-1.5">
            <button
              type="button"
              data-testid="current-task"
              onClick={openPlanner}
              className={PILL_LABEL}
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent-fg" />
              <span className="font-medium text-fg">Now</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 max-w-[24ch] truncate text-fg">{running.title}</span>
            </button>
            <button type="button" data-testid="stop-task" onClick={stop} className={`btn-glass ${PILL_ACTION} text-danger`}>
              <Icons.stop size={14} /> Stop
            </button>
          </div>
        ) : nextBlock ? (
          <div data-testid="now-next-pill" className="glass-card flex h-[46px] min-w-0 items-center gap-1 rounded-pill p-1.5">
            <button
              type="button"
              data-testid="next-task"
              onClick={openPlanner}
              className={PILL_LABEL}
            >
              <Icons.clock size={15} className="shrink-0" />
              <span className="font-medium text-fg">Next</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 max-w-[24ch] truncate text-fg">{nextBlock.title}</span>
              <span aria-hidden="true" className="hidden xl:inline">·</span>
              <span className="hidden shrink-0 xl:inline">{nextTime}</span>
            </button>
            <button type="button" data-testid="next-task-start" onClick={start} className={`btn-accent ${PILL_ACTION}`}>
              <Icons.play size={14} /> Start
            </button>
          </div>
        ) : null}

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
          className="btn-primary inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center gap-2 rounded-pill text-[15px] font-medium xl:w-auto xl:pl-4 xl:pr-5 shadow-[inset_0_1px_0_#fff,0_10px_30px_-12px_rgba(255,255,255,0.5)] [[data-theme=light]_&]:shadow-[0_10px_30px_-12px_rgba(17,18,20,0.55)]"
        >
          <Icons.plus size={18} className="shrink-0 [stroke-width:2]" /> <span className="sr-only xl:not-sr-only">New task</span>
        </button>

        <AccountMenu />
      </div>
    </header>
  );
}
