import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Settings as SettingsPage } from './Settings';
import { tokenStore } from '../../auth/tokenStore';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('Settings page', () => {
  it('shows a loading state', () => {
    const api = fakeApiClient({ getSettings: () => new Promise(() => {}) } as never);
    renderWithProviders(<SettingsPage />, { api });
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it('treats a 404 as first-time setup and seeds defaults (Mon–Fri on)', async () => {
    const api = fakeApiClient({ getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'Settings not configured')) } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect((screen.getByTestId('day-1-toggle') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('day-0-toggle') as HTMLInputElement).checked).toBe(false);
  });

  it('prefills from existing settings and saves the converted input', async () => {
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect((screen.getByTestId('horizon') as HTMLInputElement).value).toBe('7');
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    const input = (putSettings.mock.calls[0] as unknown[])[0] as { timezone: string; workingHours: unknown[] };
    expect(input.timezone).toBe('UTC');
    expect(input.workingHours).toHaveLength(1);
  });

  // Item 8: centered layout
  it('wraps content in a centered max-width container', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    const { container } = renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const wrapper = container.querySelector('.mx-auto');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain('max-w-');
  });

  it('shows the build version footer with the injected sha and date', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage version={{ version: 'a1b2c3d', buildDate: '2026-08-12' }} />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect(screen.getByTestId('app-version')).toHaveTextContent('NotReclaim a1b2c3d · built 2026-08-12');
  });

  it('omits the build date when it is unknown', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage version={{ version: 'dev', buildDate: null }} />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const el = screen.getByTestId('app-version');
    expect(el).toHaveTextContent('NotReclaim dev');
    expect(el.textContent).not.toMatch(/built/i);
  });
});

describe('Settings page — mobile-only rows', () => {
  it('links to Buffers and Hours below md', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const links = screen.getByTestId('mobile-settings-links');
    expect(links.className).toContain('md:hidden');
    expect(within(links).getByRole('link', { name: 'Buffers' })).toHaveAttribute('href', '/buffers');
    expect(within(links).getByRole('link', { name: 'Hours' })).toHaveAttribute('href', '/hours');
  });

  it('offers an account row with sign out below md', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const row = screen.getByTestId('mobile-account-row');
    expect(row.className).toContain('md:hidden');
    expect(within(row).getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('clears the stored session when the mobile Sign out is pressed', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('mobile-account-row')).getByRole('button', { name: /sign out/i }));
    expect(tokenStore.get()).toBeNull();
  });
});
