import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';

function renderSidebar(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders the routing nav items as links', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('shows the brand wordmark', () => {
    renderSidebar();
    expect(screen.getByText(/notreclaim/i)).toBeInTheDocument();
  });

  // Removed groups
  it('does not render the Meetings section', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /meetings/i })).toBeNull();
    expect(screen.queryByText('Smart Meetings')).toBeNull();
    expect(screen.queryByText('Scheduling Links')).toBeNull();
  });

  it('does not render the Focus or Tasks disabled items', () => {
    renderSidebar();
    expect(screen.queryByText('Focus')).toBeNull();
    expect(screen.queryByText('Tasks')).toBeNull();
  });

  it('shows "Time management" section (not "Time blocking")', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /time blocking/i })).toBeNull();
    expect(screen.getByRole('button', { name: /time management/i })).toBeInTheDocument();
  });

  it('shows "Settings" nav link instead of "Calendar Sync"', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Calendar Sync' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  // Review 11: the hide/pin collapse control was removed — the sidebar is always visible.
  it('has no hide / pin / collapse control', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /hide sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pin sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unpin sidebar/i })).toBeNull();
  });

  // Help section removed (Review 10)
  it('does not render the Help section', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /help/i })).toBeNull();
    expect(screen.queryByText('Documentation')).toBeNull();
  });
});
