import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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

describe('AppShell mobile chrome', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts the shell toast live region', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    expect(screen.getByTestId('toast-region')).toHaveAttribute('role', 'status');
  });

  it('mounts the mobile tab bar and the mobile top bar', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-top-bar')).toBeInTheDocument();
  });

  it('hides the desktop top bar below md', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const header = screen.getByTestId('toggle-sidebar').closest('header')!;
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('md:flex');
  });

  it('hides the sidebar below md while keeping it at md+', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.className).toContain('hidden');
    expect(sidebar.className).toContain('md:flex');
  });

  it('pads the content area so the fixed tab bar never covers it on mobile', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const content = screen.getByTestId('shell-content');
    expect(content.className).toContain('pb-[calc(56px_+_env(safe-area-inset-bottom))]');
    expect(content.className).toContain('md:pb-0');
  });
});

describe('AppShell task search', () => {
  const tasks = [
    {
      id: 'task-1', userId: 'u1', title: 'Write the quarterly report', priority: 2, sortOrder: 0,
      durationMs: 3_600_000, dueBy: null, minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null,
      status: 'pending', completedAt: null, subtasks: [], createdAt: '', updatedAt: '',
    },
  ];
  beforeEach(() => { localStorage.clear(); });

  it('opens the palette from the header Search button and restores focus on Escape', async () => {
    renderWithProviders(<AppShell />, { api: makeApi({ listTasks: async () => tasks as never }) });
    const button = screen.getByRole('button', { name: 'Search tasks' });
    button.focus();
    fireEvent.click(button);
    const input = screen.getByRole('combobox', { name: 'Search tasks' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens with "/" and Ctrl+K, but not while typing in a field', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: '/' });
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
    field.remove();

    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('dialog', { name: 'Search tasks' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Search tasks' })).toBeInTheDocument();
  });

  it('does not open over the New task dialog, even with focus on a non-field control', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    fireEvent.click(screen.getAllByRole('button', { name: 'New task' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: '/' });
    fireEvent.keyDown(close, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
  });

  it('does not open over an open popover or menu', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const popover = document.createElement('div');
    popover.setAttribute('data-testid', 'create-popover');
    document.body.appendChild(popover);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
    popover.remove();

    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
  });

  it('survives keydowns without a key (Chrome autofill)', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    window.addEventListener('error', onError);
    try {
      // A bare Event has no `key` at all (KeyboardEvent would default it to '').
      document.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true }), { ctrlKey: true }));
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
  });

  it('opens the selected task in the shell-hosted task drawer', async () => {
    renderWithProviders(<AppShell />, { api: makeApi({ listTasks: async () => tasks as never }) });
    fireEvent.click(screen.getByRole('button', { name: 'Search tasks' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quarterly' } });
    fireEvent.click(await screen.findByRole('option', { name: /Write the quarterly report/ }));
    expect(screen.queryByRole('dialog', { name: 'Search tasks' })).toBeNull();
    const drawer = await screen.findByTestId('task-drawer');
    expect(within(drawer).getByDisplayValue('Write the quarterly report')).toBeInTheDocument();
  });
});
