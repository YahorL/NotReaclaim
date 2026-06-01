import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { tokenStore } from '../auth/tokenStore';

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
    expect(screen.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(screen.getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });

  it('signs out via the account menu', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
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
        category: null, status: 'pending', timeLoggedMs: 0,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      listHabits: async () => [],
    } as never);
    renderWithProviders(<App />, { initialEntries: ['/stats'], api });
    expect(await screen.findByText(/total scheduled/i)).toBeInTheDocument();
  });

});
