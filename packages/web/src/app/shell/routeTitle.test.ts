import { describe, it, expect } from 'vitest';
import { routeTitle } from './routeTitle';

describe('routeTitle', () => {
  it('maps known routes to titles', () => {
    expect(routeTitle('/')).toBe('Planner');
    expect(routeTitle('/priorities')).toBe('Priorities');
    expect(routeTitle('/habits')).toBe('Habits');
    expect(routeTitle('/settings')).toBe('Settings');
    expect(routeTitle('/stats')).toBe('Stats');
  });
  it('falls back to the app name for unknown routes', () => {
    expect(routeTitle('/nope')).toBe('NotReclaim');
  });
});
