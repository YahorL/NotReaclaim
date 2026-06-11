const TITLES: Record<string, string> = {
  '/': 'Planner',
  '/priorities': 'Priorities',
  '/habits': 'Habits',
  '/settings': 'Settings',
  '/stats': 'Stats',
  '/buffers': 'Buffers',
  '/hours': 'Hours',
};

export function routeTitle(pathname: string): string {
  return TITLES[pathname] ?? 'NotReclaim';
}
