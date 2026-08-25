import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { Icons, type IconName } from './icons';

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

// Buffers and Hours are deliberately absent: on mobile they are reachable as link rows
// at the top of the Settings page (see the mobile-adaptation spec, section 1).
const TABS: Tab[] = [
  { to: '/', label: 'Planner', icon: 'planner', end: true },
  { to: '/priorities', label: 'Priorities', icon: 'priorities' },
  { to: '/habits', label: 'Habits', icon: 'timeblock' },
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function MobileTabBar(): ReactElement {
  return (
    <nav
      data-testid="mobile-tab-bar"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((tab) => {
        const Icon = Icons[tab.icon];
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end ?? false}
            className={({ isActive }) =>
              [
                'flex h-14 flex-1 flex-col items-center justify-center gap-1',
                isActive ? 'font-bold text-indigo' : 'font-semibold text-inkSoft',
              ].join(' ')
            }
          >
            <Icon size={21} />
            <span className="text-[10px] leading-none">{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
