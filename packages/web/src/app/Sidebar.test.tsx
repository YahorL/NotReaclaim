import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';

function renderSidebar(path = '/', pinned?: boolean) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Sidebar
          pinned={pinned ?? true}
          onUnpin={() => {}}
          onPin={() => {}}
          isOverlay={false}
        />
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
    // Calendar Sync renamed to Settings, route unchanged
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('shows the brand wordmark', () => {
    renderSidebar();
    expect(screen.getByText(/notreclaim/i)).toBeInTheDocument();
  });

  // Item 5: removed groups
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

  // Item 6: pin button
  it('pin header button has aria-label "Unpin sidebar" when pinned', () => {
    renderSidebar('/', true);
    expect(screen.getByRole('button', { name: 'Unpin sidebar' })).toBeInTheDocument();
  });

  it('calls onUnpin when the Unpin sidebar button is clicked', () => {
    let unpinCalled = false;
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Sidebar pinned onUnpin={() => { unpinCalled = true; }} onPin={() => {}} isOverlay={false} />
        </AuthProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unpin sidebar' }));
    expect(unpinCalled).toBe(true);
  });

  it('shows "Pin sidebar" button when rendered as overlay', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Sidebar pinned={false} onUnpin={() => {}} onPin={() => {}} isOverlay />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Pin sidebar' })).toBeInTheDocument();
  });
});

describe('AppShell sidebar pin/unpin', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('starts pinned by default', async () => {
    const { renderAppShell } = await import('./AppShell.testhelper');
    renderAppShell();
    // Sidebar is visible (no hidden class) and no hamburger button
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).toBeNull();
  });

  it('reads pinned=false from localStorage and shows hamburger', async () => {
    localStorage.setItem('nr.sidebarPinned', '0');
    const { renderAppShell } = await import('./AppShell.testhelper');
    renderAppShell();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
  });

  it('clicking Unpin hides the sidebar and shows hamburger', async () => {
    const { renderAppShell } = await import('./AppShell.testhelper');
    renderAppShell();
    // Initially pinned, click unpin
    fireEvent.click(screen.getByRole('button', { name: 'Unpin sidebar' }));
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
    expect(localStorage.getItem('nr.sidebarPinned')).toBe('0');
  });

  it('hamburger opens the sidebar as overlay', async () => {
    localStorage.setItem('nr.sidebarPinned', '0');
    const { renderAppShell } = await import('./AppShell.testhelper');
    renderAppShell();
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    // Once open as overlay, Pin sidebar button should appear
    expect(screen.getByRole('button', { name: 'Pin sidebar' })).toBeInTheDocument();
  });

  it('clicking Pin sidebar from overlay restores pinned layout', async () => {
    localStorage.setItem('nr.sidebarPinned', '0');
    const { renderAppShell } = await import('./AppShell.testhelper');
    renderAppShell();
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin sidebar' }));
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).toBeNull();
    expect(localStorage.getItem('nr.sidebarPinned')).toBe('1');
  });
});
