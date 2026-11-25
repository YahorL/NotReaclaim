import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { tokenStore } from '../auth/tokenStore';
import { act } from '@testing-library/react';
import { installMatchMedia } from '../test/matchMedia';
import { resetThemeStoreForTests } from '../theme/useTheme';
import { DARK_QUERY } from '../theme/theme';

function authedApi() {
  return fakeApiClient({
    getSchedule: async () => [],
    getCalendarEvents: async () => [],
    getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
    listTasks: async () => [],
    listHabits: async () => [],
  } as never);
}

beforeEach(() => localStorage.clear());

describe('App routing', () => {
  it('redirects to /signin when unauthenticated', () => {
    renderWithProviders(<App />, { initialEntries: ['/'] });
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('renders the shell with nav links when authenticated', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: 'Priorities' })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(within(screen.getByTestId('sidebar')).getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });

  it('navigates to the Habits page via the mobile tab bar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(within(screen.getByTestId('mobile-tab-bar')).getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });

  it('signs out via the account menu', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('renders the Priorities board at /priorities', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/priorities'], api: authedApi() });
    expect(await screen.findByPlaceholderText(/search for something/i)).toBeInTheDocument();
  });

  it('redirects /tasks to /priorities', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/tasks'], api: authedApi() });
    expect(await screen.findByPlaceholderText(/search for something/i)).toBeInTheDocument();
  });

  it('renders the Stats dashboard at /stats', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    const api = fakeApiClient({
      getSchedule: async () => [],
      getCalendarEvents: async () => [],
      getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
      listTasks: async () => [{
        id: 't1', userId: 'u1', title: 'x', priority: 2, durationMs: 3_600_000,
        dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
        category: null, status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      listHabits: async () => [],
    } as never);
    renderWithProviders(<App />, { initialEntries: ['/stats'], api });
    expect(await screen.findByText(/total scheduled/i)).toBeInTheDocument();
  });

});

describe('App theme', () => {
  // The rail's ThemeSwitch is absent on the auth pages and when the sidebar is hidden, so the
  // OS-theme subscription must live at the app root.
  it.each([
    ['the sign-in page', false, '/signin'],
    ['the shell with the sidebar hidden', true, '/'],
  ])('follows prefers-color-scheme on %s', (_name, authed, path) => {
    resetThemeStoreForTests();
    if (authed) {
      tokenStore.set({ token: 'jwt', userId: 'u1' });
      localStorage.setItem('nr.sidebarHidden', 'true');
    }
    const mm = installMatchMedia({ [DARK_QUERY]: true });
    try {
      renderWithProviders(<App />, { initialEntries: [path], api: authedApi() });
      if (authed) expect(screen.queryByTestId('sidebar')).toBeNull();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      act(() => { mm.set(DARK_QUERY, false); });
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    } finally {
      mm.restore();
    }
  });
});
