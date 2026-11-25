import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthContext';
import { resetThemeStoreForTests } from '../theme/useTheme';
import { Sidebar } from './Sidebar';

function renderSidebar(path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Sidebar />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { localStorage.clear(); resetThemeStoreForTests(); });

describe('Sidebar rail', () => {
  it('is the main navigation landmark', () => {
    renderSidebar();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBe(screen.getByTestId('sidebar'));
  });

  it('renders every routing destination as a named link', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Buffers' })).toHaveAttribute('href', '/buffers');
    expect(screen.getByRole('link', { name: 'Hours' })).toHaveAttribute('href', '/hours');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('links the logo home', () => {
    renderSidebar('/stats');
    expect(screen.getByRole('link', { name: 'NotReclaim home' })).toHaveAttribute('href', '/');
  });

  it('groups the links statically: Plan and Time management (no collapsible section)', () => {
    renderSidebar();
    const plan = within(screen.getByRole('group', { name: 'Plan' }));
    expect(plan.getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['Planner', 'Priorities', 'Stats']);
    const time = within(screen.getByRole('group', { name: 'Time management' }));
    expect(time.getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['Habits', 'Buffers', 'Hours']);
    expect(screen.queryByRole('button', { name: /time management/i })).toBeNull();
  });

  it('marks the current route active', () => {
    renderSidebar('/habits');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Planner' })).not.toHaveAttribute('aria-current');
  });

  it('holds the theme switch', () => {
    renderSidebar();
    expect(within(screen.getByTestId('sidebar')).getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });

  // Removed groups
  it('does not render the Meetings, Focus, Tasks or Help items', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /meetings/i })).toBeNull();
    expect(screen.queryByText('Smart Meetings')).toBeNull();
    expect(screen.queryByText('Scheduling Links')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Focus' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: /help/i })).toBeNull();
    expect(screen.queryByText('Documentation')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Calendar Sync' })).toBeNull();
  });

  // Review 11: the hide/pin collapse control lives in the header, never in the rail.
  it('has no hide / pin / collapse control', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /hide sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pin sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unpin sidebar/i })).toBeNull();
  });
});
