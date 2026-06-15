import { useState } from 'react';
import { Logo } from './shell/Logo';
import { NavLinkItem, NavSection } from './shell/NavItem';
import { Icons } from './shell/icons';

export function Sidebar() {
  const [tbOpen, setTbOpen] = useState(true);

  return (
    <aside data-testid="sidebar" className="dark-scroll flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      <div className="flex items-center px-[18px] pb-[14px] pt-5">
        <Logo />
      </div>

      <nav className="flex flex-col gap-0.5 px-[14px] py-1.5">
        <NavLinkItem to="/" end label="Planner" icon={<Icons.planner size={20} />} />
        <NavLinkItem to="/priorities" label="Priorities" icon={<Icons.priorities size={20} />} />
        <NavLinkItem to="/stats" label="Stats" icon={<Icons.stats size={20} />} />

        <NavSection label="Time management" icon={<Icons.timeblock size={20} />} open={tbOpen} onToggle={() => setTbOpen((v) => !v)} />
        {tbOpen && (
          <>
            <NavLinkItem to="/habits" label="Habits" indent />
            <NavLinkItem to="/buffers" label="Buffers" indent />
            <NavLinkItem to="/hours" label="Hours" indent />
          </>
        )}

        <NavLinkItem to="/settings" label="Settings" icon={<Icons.settings size={20} />} />
      </nav>

      <div className="flex-1" />
    </aside>
  );
}
