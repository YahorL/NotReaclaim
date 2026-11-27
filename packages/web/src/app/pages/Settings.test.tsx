import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient, gatewayError } from '../../test/fakes';
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

  it('prefills from existing settings and saves the converted input with a PATCH that leaves the buffers out', async () => {
    const patchSettings = vi.fn(async () => settings());
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings({ meetingBufferMs: 300_000, taskBufferMs: 600_000 }), patchSettings, putSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect((screen.getByTestId('horizon') as HTMLInputElement).value).toBe('7');
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(patchSettings).toHaveBeenCalled());
    const input = (patchSettings.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(input.timezone).toBe('UTC');
    expect(input.workingHours).toHaveLength(1);
    // The buffers belong to the Buffers page: sending the values loaded here would revert a
    // buffer change saved there meanwhile.
    expect(input).not.toHaveProperty('meetingBufferMs');
    expect(input).not.toHaveProperty('taskBufferMs');
    expect(Object.keys(input).sort()).toEqual(
      ['dayStartMinute', 'defaultMaxChunkMs', 'defaultMinChunkMs', 'horizonDays', 'requireStartToTrack', 'timezone', 'workingHours'],
    );
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('a stored buffer above 24 h (from before the cap) no longer blocks a Settings save', async () => {
    const patchSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings({ meetingBufferMs: 30 * 3_600_000 }), patchSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect(screen.getByTestId('save')).toBeEnabled();
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
    expect((patchSettings.mock.calls[0] as unknown[])[0]).not.toHaveProperty('meetingBufferMs');
    expect(screen.queryByTestId('form-error')).not.toBeInTheDocument();
  });

  it('first-time setup (no settings yet, so nothing to PATCH) creates them with a PUT whose buffers are the defaults', async () => {
    const patchSettings = vi.fn(async () => settings());
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({
      getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'Settings not configured')), patchSettings, putSettings,
    } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0] as unknown[])[0]).toMatchObject({ meetingBufferMs: 0, taskBufferMs: 0, horizonDays: 14 });
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('first-time setup: turning Require Start on asks nothing (there is no tracked time yet) (W7)', async () => {
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({
      getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'Settings not configured')), putSettings,
    } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('require-start'));
    fireEvent.click(screen.getByTestId('save'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0] as unknown[])[0]).toMatchObject({ requireStartToTrack: true });
  });

  it('configured settings (a row exists): turning Require Start on asks first (round 3)', async () => {
    const patchSettings = vi.fn(async () => settings({ requireStartToTrack: true }));
    renderWithProviders(<SettingsPage />, { api: fakeApiClient({ getSettings: async () => settings({ requireStartToTrack: false }), patchSettings } as never) });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('require-start'));
    fireEvent.click(screen.getByTestId('save'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('first-time setup, then a row exists: the next switch on asks (round 3)', async () => {
    const putSettings = vi.fn(async () => settings({ requireStartToTrack: false }));
    const patchSettings = vi.fn(async () => settings({ requireStartToTrack: true }));
    let configured = false;
    const getSettings = vi.fn(async () => {
      if (!configured) throw new ApiError(404, 'not_found', 'Settings not configured');
      return settings({ requireStartToTrack: false });
    });
    renderWithProviders(<SettingsPage />, { api: fakeApiClient({ getSettings, putSettings: vi.fn(async (i: unknown) => { configured = true; return putSettings(i as never); }), patchSettings } as never) });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('save')); // first save creates the row (Require Start off)
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('require-start'));
    fireEvent.click(screen.getByTestId('save'));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(patchSettings).not.toHaveBeenCalled();
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

  it('offers the Appearance theme choice and the Account section', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const appearance = screen.getByTestId('appearance-section');
    expect(within(appearance).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(within(appearance).getAllByRole('radio').map((r) => r.textContent)).toEqual(['System', 'Light', 'Dark']);
    expect(screen.getByTestId('account-section')).toBeInTheDocument();
    // Appearance applies instantly, so it lives outside the Save form
    expect(within(screen.getByTestId('settings-form')).queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
  });

  it('shows the build version footer with the injected sha and date', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage version={{ version: 'a1b2c3d', buildDate: '2026-08-12' }} />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect(screen.getByTestId('app-version')).toHaveTextContent('NotReclaim a1b2c3d · built 2026-08-12');
  });

  it('shows the server\'s message when a save is rejected', async () => {
    const patchSettings = vi.fn(async () => { throw new ApiError(400, 'validation_error', 'timezone: must be a valid IANA time zone'); });
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent('timezone: must be a valid IANA time zone'));
  });

  it('says it could not save when the request never reached the server (network failure)', async () => {
    const patchSettings = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent("Couldn't save. Check your connection and try again."));
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
  });

  it('says it could not save when the API is down behind its proxy (502 page), not "Request failed with status 502"', async () => {
    const failure = await gatewayError(502);
    const patchSettings = vi.fn(async () => { throw failure; });
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent("Couldn't save. Check your connection and try again."));
    expect(screen.getByTestId('form-error')).not.toHaveTextContent(/status 502/);
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

  it('gives Sign out a touch-sized target', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByText('Sign out')).toBeInTheDocument());
    expect(screen.getByText('Sign out').className).toContain('coarse:py-3');
  });
});
