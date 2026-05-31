import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';

function renderSidebar(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><Sidebar /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders the routing nav items as links', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Calendar Sync' })).toHaveAttribute('href', '/settings');
  });

  it('renders aspirational items as disabled with Soon', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Smart Meetings' })).toBeNull();
    expect(screen.getByText('Smart Meetings')).toBeInTheDocument();
    expect(screen.getAllByText(/soon/i).length).toBeGreaterThan(0);
  });

  it('shows the brand wordmark', () => {
    renderSidebar();
    expect(screen.getByText(/notreclaim/i)).toBeInTheDocument();
  });
});
