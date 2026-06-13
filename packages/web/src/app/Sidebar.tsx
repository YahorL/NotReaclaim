import { useState } from 'react';
import { Logo } from './shell/Logo';
import { NavLinkItem, NavSection } from './shell/NavItem';
import { Icons } from './shell/icons';

interface SidebarProps {
  pinned: boolean;
  onUnpin: () => void;
  onPin: () => void;
  isOverlay: boolean;
}

export function Sidebar({ pinned, onUnpin, onPin, isOverlay }: SidebarProps) {
  const [tbOpen, setTbOpen] = useState(true);

  // Pinned → a collapse arrow that hides the sidebar; opened-but-unpinned → a pin glyph
  // that makes it permanent. (Previously both states showed the pin glyph — "not arrow nor pin".)
  const collapseButton = isOverlay
    ? (
      <button type="button" aria-label="Pin sidebar" title="Pin sidebar" onClick={onPin} className="text-sidebarMuted hover:text-sidebarText">
        <Icons.pin size={18} />
      </button>
    )
    : (
      <button type="button" aria-label="Hide sidebar" title="Hide sidebar" onClick={onUnpin} className="text-sidebarMuted hover:text-sidebarText">
        <Icons.panelLeft size={19} />
      </button>
    );

  return (
    <aside className="dark-scroll flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      <div className="flex items-center justify-between px-[18px] pb-[14px] pt-5">
        <Logo />
        {collapseButton}
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
