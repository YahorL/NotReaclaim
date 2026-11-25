import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  it('a negative buffer sends no request', async () => {
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('save'));
    await new Promise((r) => setTimeout(r, 0));
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('the Save handler itself refuses an invalid form, independently of the disabled attribute', async () => {
    // A click on a disabled button never reaches onClick (jsdom and React both drop it), so the test
    // above would pass without the handler's own guard. Call the handler directly to pin the guard.
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '-5' } });
    const save = screen.getByTestId('save');
    expect(save).toBeDisabled();
    const propsKey = Object.keys(save).find((k) => k.startsWith('__reactProps$'))!;
    act(() => { (save as unknown as Record<string, { onClick: () => void }>)[propsKey]!.onClick(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('a negative buffer shows the Settings validation error under that field and disables Save', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    expect(screen.queryByTestId('err-taskBufferMs')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '-1' } });
    expect(screen.getByTestId('err-taskBufferMs')).toHaveTextContent('Buffer must be a whole number of minutes (≥ 0)');
    expect(screen.queryByTestId('err-meetingBufferMs')).not.toBeInTheDocument();
    expect(screen.getByTestId('save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '3' } });
    expect(screen.queryByTestId('err-taskBufferMs')).not.toBeInTheDocument();
    expect(screen.getByTestId('save')).not.toBeDisabled();
  });

  it('a rejected save shows the server error and no Saved line; a later successful save clears it', async () => {
    const putSettings = vi.fn()
      .mockRejectedValueOnce(new ApiError(400, 'validation_error', 'taskBufferMs must be non-negative'))
      .mockResolvedValueOnce(settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent('taskBufferMs must be non-negative'));
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
    expect(screen.queryByTestId('form-error')).not.toBeInTheDocument();
  });

  it('a save that fails without an API response (network error) still shows an error', async () => {
    const putSettings = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent(/couldn't save/i));
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
  });

  describe('typed values are validated as typed', () => {
    const load = async () => {
      const putSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
      return { putSettings };
    };

    it('keeps a fractional value as typed and flags it instead of rounding it', async () => {
      const { putSettings } = await load();
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '1.5' } });
      expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('1.5');
      expect(screen.getByTestId('err-meetingBufferMs')).toHaveTextContent('Buffer must be a whole number of minutes (≥ 0)');
      expect(screen.getByTestId('save')).toBeDisabled();
      fireEvent.click(screen.getByTestId('save'));
      await new Promise((r) => setTimeout(r, 0));
      expect(putSettings).not.toHaveBeenCalled();
    });

    it('flags an emptied field instead of saving it as 0', async () => {
      await load();
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '' } });
      expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('');
      expect(screen.getByTestId('err-taskBufferMs')).toHaveTextContent('Buffer must be a whole number of minutes (≥ 0)');
      expect(screen.getByTestId('save')).toBeDisabled();
    });

    it('caps a buffer at 24 hours', async () => {
      await load();
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '1441' } });
      expect(screen.getByTestId('err-taskBufferMs')).toHaveTextContent('Buffer must be at most 24 hours (1440 min)');
      expect(screen.getByTestId('save')).toBeDisabled();
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '1440' } });
      expect(screen.queryByTestId('err-taskBufferMs')).not.toBeInTheDocument();
      expect(screen.getByTestId('save')).not.toBeDisabled();
    });

    it('drops the Saved label as soon as the form is edited again', async () => {
      await load();
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '-1' } });
      expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
      expect(screen.getByTestId('save')).toBeDisabled();
    });
  });
});
