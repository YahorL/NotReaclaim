import { useState } from 'react';
import { Logo } from './shell/Logo';
import { NavLinkItem, NavDisabledItem, NavSection } from './shell/NavItem';
import { Icons } from './shell/icons';

interface SidebarProps {
  pinned: boolean;
  onUnpin: () => void;
  onPin: () => void;
  isOverlay: boolean;
}

export function Sidebar({ pinned, onUnpin, onPin, isOverlay }: SidebarProps) {
  const [tbOpen, setTbOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const pinButton = isOverlay
    ? (
      <button
        type="button"
        aria-label="Pin sidebar"
        onClick={onPin}
        className="text-sidebarMuted hover:text-sidebarText"
      >
        <Icons.pin size={18} />
      </button>
    )
    : (
      <button
        type="button"
        aria-label="Unpin sidebar"
        onClick={onUnpin}
        className="text-sidebarMuted hover:text-sidebarText"
      >
        <Icons.pin size={18} />
      </button>
    );

  return (
    <aside className="dark-scroll flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      <div className="flex items-center justify-between px-[18px] pb-[14px] pt-5">
        <Logo />
        {pinButton}
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
            <NavLinkItem to="/hours" label="Hours" icon={<Icons.clock size={16} />} indent />
          </>
        )}

        <NavLinkItem to="/settings" label="Settings" icon={<Icons.sync size={20} />} />
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 px-[14px] pb-[18px] pt-2.5">
        <NavSection label="Help" icon={<Icons.help size={20} />} open={helpOpen} onToggle={() => setHelpOpen((v) => !v)} />
        {helpOpen && (
          <>
            <NavDisabledItem label="Documentation" indent />
            <NavDisabledItem label="Contact support" indent />
            <NavDisabledItem label="What's new" indent />
          </>
        )}
      </div>
    </aside>
  );
}
