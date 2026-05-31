import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icons } from './icons';

const ROW_BASE = 'flex w-full items-center gap-[13px] rounded-[9px] text-left transition-colors';
const PAD = (indent?: boolean) => (indent ? 'py-2 pl-[50px] pr-3.5 text-[14.5px]' : 'px-3.5 py-2.5 text-[15.5px]');

export function NavLinkItem({
  to, label, icon, end = false, indent = false,
}: { to: string; label: string; icon?: ReactNode; end?: boolean; indent?: boolean }) {
  return (
    <NavLink
      to={to} end={end}
      className={({ isActive }) =>
        [
          ROW_BASE, PAD(indent),
          isActive
            ? 'bg-sidebarHover font-bold text-white'
            : indent
              ? 'font-medium text-sidebarMuted hover:bg-white/5'
              : 'font-medium text-sidebarText hover:bg-white/5',
        ].join(' ')
      }
    >
      {icon && <span className="shrink-0 opacity-90">{icon}</span>}
      <span className="flex-1">{label}</span>
    </NavLink>
  );
}

export function NavDisabledItem({ label, icon, indent = false }: { label: string; icon?: ReactNode; indent?: boolean }) {
  return (
    <div
      className={[ROW_BASE, PAD(indent), 'cursor-default font-medium text-sidebarMuted/70'].join(' ')}
      aria-disabled="true"
    >
      {icon && <span className="shrink-0 opacity-50">{icon}</span>}
      <span className="flex-1">{label}</span>
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebarMuted">
        Soon
      </span>
    </div>
  );
}

export function NavSection({
  label, icon, open, onToggle,
}: { label: string; icon?: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle}
      className={[ROW_BASE, PAD(false), 'font-medium text-sidebarText hover:bg-white/5'].join(' ')}
    >
      {icon && <span className="shrink-0 opacity-90">{icon}</span>}
      <span className="flex-1">{label}</span>
      {open ? <Icons.chevUp size={18} /> : <Icons.chevDown size={18} />}
    </button>
  );
}
