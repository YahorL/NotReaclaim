import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Buffers } from './Buffers';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  meetingBufferMs: 300_000, taskBufferMs: 600_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('Buffers page', () => {
  it('shows a loading state', () => {
    const api = fakeApiClient({ getSettings: () => new Promise(() => {}) } as never);
    renderWithProviders(<Buffers />, { api });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('loads and prefills buffer values from settings', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10');
  });

  it('treats a 404 as first-time setup (buffers default to 0)', async () => {
    const api = fakeApiClient({
      getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'not found')),
    } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect(screen.getByTestId('meeting-buffer')).toBeInTheDocument());
    expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('0');
  });

  it('Save PUTs the full settings payload with the edited buffer value', async () => {
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ meetingBufferMs: 300_000, taskBufferMs: 900_000, timezone: 'UTC' }),
    ));
  });
});
