import { useLocation } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { AccountMenu } from './AccountMenu';

export function TopBar({ onNewTask }: { onNewTask: () => void }) {
  const { pathname } = useLocation();
  return (
    <header className="flex h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px]">
      <h1 className="flex-1 text-[27px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

      <button type="button" disabled aria-label="Find a time (coming soon)"
        className="flex cursor-default items-center gap-1.5 rounded-[9px] px-3 py-2 text-[15.5px] font-semibold text-ink/40">
        <Icons.clock size={18} /> Find a time
        <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-inkSoft">Soon</span>
      </button>

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
