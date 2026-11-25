import { Logo } from './shell/Logo';
import { NavLinkItem, RAIL_GROUP } from './shell/NavItem';
import { Icons } from './shell/icons';
import { ThemeSwitch } from './shell/ThemeSwitch';

/**
 * The 76px glass rail (md+ only; phones use MobileTabBar). Groups are static — the old
 * collapsible "Time management" section is gone. `relative z-30` keeps the CSS tooltips, which
 * overhang to the right, above the content column; for the same reason the rail never clips
 * (no overflow) its children.
 */
export function Sidebar() {
  return (
    <nav
      data-testid="sidebar"
      aria-label="Main"
      className="glass relative z-30 hidden w-[76px] shrink-0 flex-col items-center gap-2.5 self-stretch rounded-panel py-3.5 md:flex [@media(max-height:760px)]:gap-1.5 [@media(max-height:760px)]:py-2.5"
    >
      <Logo />
      <div role="group" aria-label="Plan" className={RAIL_GROUP}>
        <NavLinkItem to="/" end label="Planner" icon={<Icons.planner size={20} />} />
        <NavLinkItem to="/priorities" label="Priorities" icon={<Icons.priorities size={20} />} />
        <NavLinkItem to="/stats" label="Stats" icon={<Icons.stats size={20} />} />
      </div>
      <span aria-hidden="true" className="mt-1.5 [@media(max-height:760px)]:mt-0 text-[10px] uppercase tracking-[0.12em] text-fg-3">Time</span>
      <div role="group" aria-label="Time management" className={RAIL_GROUP}>
        <NavLinkItem to="/habits" label="Habits" icon={<Icons.habits size={20} />} />
        <NavLinkItem to="/buffers" label="Buffers" icon={<Icons.buffers size={20} />} />
        <NavLinkItem to="/hours" label="Hours" icon={<Icons.hours size={20} />} />
      </div>
      <span aria-hidden="true" className="min-h-6 flex-1 [@media(max-height:760px)]:min-h-0" />
      <ThemeSwitch />
      <div className={RAIL_GROUP}>
        <NavLinkItem to="/settings" label="Settings" icon={<Icons.settings size={20} />} />
      </div>
    </nav>
  );
}
