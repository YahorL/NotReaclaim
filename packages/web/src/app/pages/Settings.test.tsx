import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Settings as SettingsPage } from './Settings';

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
});
