import { DateTime } from 'luxon';

export interface RouteHeader {
  /** The small line above the title ('' = none). */
  eyebrow: string;
  /** Title as [before, bold, after]: "Your **week** planner". */
  title: [string, string, string];
}

export interface RouteHeaderContext {
  nowMs: number;
  /** settings.timezone — the date and week are the user's, not the browser's. */
  zone: string;
  /** Active (pending/scheduled) tasks for the Priorities eyebrow; null while unknown. */
  openTaskCount: number | null;
}

const PRIORITY_HINT = 'across 4 priority levels · drag to reorder';

/** Desktop header copy per route (spec §4.1). Pure: the clock and zone are passed in. */
export function routeHeader(pathname: string, { nowMs, zone, openTaskCount }: RouteHeaderContext): RouteHeader {
  const now = DateTime.fromMillis(nowMs, { zone }).setLocale('en-US');
  switch (pathname) {
    case '/':
      return { eyebrow: `${now.toFormat('cccc, LLLL d')} · Week ${now.weekNumber}`, title: ['Your ', 'week', ' planner'] };
    case '/priorities':
      return {
        eyebrow: openTaskCount == null
          ? `Tasks ${PRIORITY_HINT}`
          : `${openTaskCount} open ${openTaskCount === 1 ? 'task' : 'tasks'} ${PRIORITY_HINT}`,
        title: ['Your ', 'priorities', ''],
      };
    case '/stats': {
      // The same Mon–Sun settings-zone week the Stats page reports on.
      const mon = now.startOf('week');
      return { eyebrow: `Week ${now.weekNumber} · ${mon.toFormat('LLL d')} – ${mon.plus({ days: 6 }).toFormat('LLL d')}`, title: ['Your ', 'stats', ''] };
    }
    case '/habits':
      return { eyebrow: 'Time management', title: ['Your ', 'habits', ''] };
    case '/buffers':
      return { eyebrow: 'Time management', title: ['Scheduling ', 'buffers', ''] };
    case '/hours':
      return { eyebrow: 'Time management', title: ['Your ', 'hours', ''] };
    case '/settings':
      return { eyebrow: 'Preferences', title: ['', 'Settings', ''] };
    default:
      return { eyebrow: '', title: ['', 'NotReclaim', ''] };
  }
}

const TITLES: Record<string, string> = {
  '/': 'Planner',
  '/priorities': 'Priorities',
  '/habits': 'Habits',
  '/settings': 'Settings',
  '/stats': 'Stats',
  '/buffers': 'Buffers',
  '/hours': 'Hours',
};

/** Plain short title for the compact MobileTopBar, where the 48px headline does not fit. */
export function routeTitle(pathname: string): string {
  return TITLES[pathname] ?? 'NotReclaim';
}
