const TITLES: Record<string, string> = {
  '/': 'Planner',
  '/priorities': 'Priorities',
  '/habits': 'Habits',
  '/settings': 'Settings',
  '/stats': 'Stats',
};

export function routeTitle(pathname: string): string {
  return TITLES[pathname] ?? 'NotReclaim';
}
