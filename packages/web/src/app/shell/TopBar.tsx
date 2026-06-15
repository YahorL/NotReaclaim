import { useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { AccountMenu } from './AccountMenu';
import { useScheduleQuery, useStartBlockMutation } from '../../api/queries';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';

interface TopBarProps {
  onNewTask: () => void;
  now?: () => number;
}

export function TopBar({ onNewTask, now = Date.now }: TopBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scheduleQ = useScheduleQuery();
  const startBlock = useStartBlockMutation();
  const nowMs = now();

  const nextBlock = (scheduleQ.data ?? [])
    .filter((b) => b.taskId != null && Date.parse(b.startsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;

  return (
    <header className="flex h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px]">
      <h1 className="flex-1 text-[27px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

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
          {nextBlock.startedAt
            ? <span data-testid="next-task-started" className="text-[13px] font-semibold text-inkSoft">Started</span>
            : (
              <button
                type="button"
                data-testid="next-task-start"
                onClick={() => startBlock.mutate(nextBlock.id)}
                className="rounded-[9px] bg-indigo px-3 py-2 text-[13px] font-bold text-white hover:bg-indigo600"
              >
                Start
              </button>
            )}
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
