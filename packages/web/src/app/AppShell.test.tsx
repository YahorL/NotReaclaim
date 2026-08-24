import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { AppShell } from './AppShell';

function makeApi(over: Parameters<typeof fakeApiClient>[0] = {}) {
  return fakeApiClient({
    getSchedule: async () => [],
    listTasks: async () => [],
    listHabits: async () => [],
    getSettings: async () => ({ workdayStart: '08:00', workdayEnd: '23:59', buffers: [] } as never),
    listCategories: async () => [],
    getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
    getGoogleStatus: async () => ({ connected: false, brokenAt: null }),
    ...over,
  });
}

describe('AppShell google banner', () => {
  it('shows the broken-connection banner above the page when Google auth is broken', async () => {
    renderWithProviders(<AppShell />, {
      api: makeApi({ getGoogleStatus: async () => ({ connected: true, brokenAt: '2026-08-24T10:00:00.000Z' }) }),
    });
    expect(await screen.findByTestId('google-broken-banner')).toBeInTheDocument();
  });

  it('shows no banner when Google is healthy', async () => {
    renderWithProviders(<AppShell />, {
      api: makeApi({ getGoogleStatus: async () => ({ connected: true, brokenAt: null }) }),
    });
    await waitFor(() => expect(screen.queryByTestId('google-broken-banner')).toBeNull());
  });
});

describe('AppShell sidebar toggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the sidebar by default', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('hides the sidebar when the toggle button is clicked', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });

  it('shows the sidebar again when toggled a second time', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(screen.queryByTestId('sidebar')).toBeNull();
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('persists hidden state to localStorage', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(localStorage.getItem('nr.sidebarHidden')).toBe('true');
  });

  it('reads initial hidden state from localStorage', () => {
    localStorage.setItem('nr.sidebarHidden', 'true');
    renderWithProviders(<AppShell />, { api: makeApi() });
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });
});
