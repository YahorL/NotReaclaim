import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient, gatewayError } from '../../test/fakes';
import { Buffers } from './Buffers';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  meetingBufferMs: 300_000, taskBufferMs: 600_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

/** Exposes the test's QueryClient so a test can refetch settings while the page stays mounted. */
function GrabClient({ onClient }: { onClient: (c: QueryClient) => void }) {
  onClient(useQueryClient());
  return null;
}

const valueOf = (id: string) => (screen.getByTestId(id) as HTMLInputElement).value;

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

  // Replaces "Save PUTs the full settings payload…", which pinned the defect: a PUT of the
  // settings captured on page load reverted any change made meanwhile in another tab.
  it('Save PATCHes only the edited buffer value, never the rest of the settings', async () => {
    const patchSettings = vi.fn(async () => settings());
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings, putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
    expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 900_000 });
    expect(putSettings).not.toHaveBeenCalled();
  });

  describe('only what was edited is sent', () => {
    it('an untouched buffer is not sent, so it cannot revert a change saved elsewhere', async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '20' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledWith({ meetingBufferMs: 1_200_000 }));
    });

    it('a stored value that is not whole minutes (90 000 ms, shown as 2) is not rewritten by saving the other field', async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings({ meetingBufferMs: 90_000 }), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('2'));
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 900_000 });
    });

    it('Save is disabled until a field differs from what was loaded or last saved', async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
      expect(screen.getByTestId('save')).toBeDisabled();
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      expect(screen.getByTestId('save')).toBeEnabled();
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '10' } });
      expect(screen.getByTestId('save')).toBeDisabled();

      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      expect(screen.getByTestId('save')).toBeDisabled(); // 15 is now what was saved

      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '7' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(2));
      expect(patchSettings).toHaveBeenLastCalledWith({ meetingBufferMs: 420_000 });
    });

    it('first-time setup sends both buffers as shown, so saving again before settings exist does not PUT 0 over the first save', async () => {
      const putSettings = vi.fn(async () => settings());
      const api = fakeApiClient({
        getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'not found')), putSettings,
      } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect(screen.getByTestId('task-buffer')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(2));
      expect(putSettings).toHaveBeenLastCalledWith(expect.objectContaining({ meetingBufferMs: 0, taskBufferMs: 900_000 }));
    });

    it('first-time setup can save with nothing edited (it creates the settings), with a PUT of the defaults', async () => {
      const putSettings = vi.fn(async () => settings());
      const api = fakeApiClient({
        getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'not found')), putSettings,
      } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect(screen.getByTestId('task-buffer')).toBeInTheDocument());
      expect(screen.getByTestId('save')).toBeEnabled();
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(putSettings).toHaveBeenCalledWith(
        expect.objectContaining({ meetingBufferMs: 0, taskBufferMs: 0, defaultMinChunkMs: 30 * 60_000 }),
      ));
    });
  });

  it('first-time setup (no settings yet) saves the defaults plus the buffers with a PUT', async () => {
    const patchSettings = vi.fn(async () => settings());
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({
      getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'not found')), patchSettings, putSettings,
    } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect(screen.getByTestId('task-buffer')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ meetingBufferMs: 0, taskBufferMs: 900_000, defaultMinChunkMs: 30 * 60_000 }),
    ));
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('a negative buffer sends no request', async () => {
    const patchSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('save'));
    await new Promise((r) => setTimeout(r, 0));
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('the Save handler itself refuses an invalid form, independently of the disabled attribute', async () => {
    // A click on a disabled button never reaches onClick (jsdom and React both drop it), so the test
    // above would pass without the handler's own guard. Call the handler directly to pin the guard.
    const patchSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '-5' } });
    const save = screen.getByTestId('save');
    expect(save).toBeDisabled();
    const propsKey = Object.keys(save).find((k) => k.startsWith('__reactProps$'))!;
    act(() => { (save as unknown as Record<string, { onClick: () => void }>)[propsKey]!.onClick(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(patchSettings).not.toHaveBeenCalled();
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
    const patchSettings = vi.fn()
      .mockRejectedValueOnce(new ApiError(400, 'validation_error', 'taskBufferMs must be non-negative'))
      .mockResolvedValueOnce(settings());
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent('taskBufferMs must be non-negative'));
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
    expect(screen.queryByTestId('form-error')).not.toBeInTheDocument();
  });

  it('a save that fails without an API response (network error) still shows an error', async () => {
    const patchSettings = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent(/couldn't save/i));
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
  });

  it('the − / + steppers move a buffer by 5 minutes and floor at 0', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
    fireEvent.click(screen.getByRole('button', { name: 'Increase buffer around meetings' }));
    expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease buffer around meetings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease buffer around meetings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease buffer around meetings' }));
    expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('0');
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase gap between tasks' }));
    expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10');
  });

  it('has no upper clamp: stepping past 60 keeps going and saves', async () => {
    // Saved with a PATCH of the stepped buffer alone (fix/followups: the Buffers page sends only the edited field).
    const patchSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings({ taskBufferMs: 3_600_000 }), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('60'));
    fireEvent.click(screen.getByRole('button', { name: 'Increase gap between tasks' }));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(patchSettings).toHaveBeenCalledWith(expect.objectContaining({ taskBufferMs: 65 * 60_000 })));
  });

  it('labels each number field and describes it with its helper text', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    const input = await screen.findByLabelText('Buffer around meetings');
    expect(input).toBe(screen.getByTestId('meeting-buffer'));
    expect(input).toHaveAccessibleDescription('Minutes kept free before and after each meeting');
  });

  it('shows "Unsaved changes" after an edit; a successful save swaps it for "Saved"; a later edit brings it back', async () => {
    const patchSettings = vi.fn(async () => settings({ taskBufferMs: 900_000 }));
    // The refetch after the save still returns the old values: the status must not depend on it.
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    expect(screen.queryByTestId('unsaved')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
    expect(screen.queryByTestId('unsaved')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '20' } });
    expect(screen.getByTestId('unsaved')).toBeInTheDocument();
    expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
    // editing back to the saved value is clean again
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    expect(screen.queryByTestId('unsaved')).not.toBeInTheDocument();
  });

  it('a failed save leaves the edit unsaved', async () => {
    const patchSettings = vi.fn().mockRejectedValue(new ApiError(400, 'validation_error', 'nope'));
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toBeInTheDocument());
    expect(screen.getByTestId('unsaved')).toBeInTheDocument();
  });

  it('the preview follows the edited values', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect(screen.getByTestId('legend-buffer')).toHaveTextContent('Buffer · 5 min'));
    expect(screen.getByTestId('legend-gap')).toHaveTextContent('Gap · 10 min');
    const meetingWidth = () => screen.getAllByTestId('preview-segment').find((s) => s.dataset.kind === 'meeting')!.style.width;
    const before = parseFloat(meetingWidth());
    fireEvent.click(screen.getByRole('button', { name: 'Increase buffer around meetings' }));
    expect(screen.getByTestId('legend-buffer')).toHaveTextContent('Buffer · 10 min');
    expect(parseFloat(meetingWidth())).toBeLessThan(before);
  });

  it('the preview strip fits its card instead of scrolling (phone width)', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect(screen.getByTestId('legend-buffer')).toHaveTextContent('Buffer · 5 min'));
    const strip = screen.getByTestId('preview-strip');
    // Layout guarantee: no fixed minimum width and no horizontal scroller around the segments.
    expect(strip.className).not.toMatch(/min-w-\[/);
    expect(strip.parentElement!.className).not.toMatch(/overflow-x-auto/);
    expect(strip).toHaveClass('min-w-0');
    const total = screen.getAllByTestId('preview-segment').reduce((a, s) => a + parseFloat(s.style.width), 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it('leaves the page title to the shell header (no duplicate card heading)', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect(screen.getByTestId('meeting-buffer')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /scheduling buffers/i })).toBeNull();
  });

  it('a save the proxy answers with 502 (API down or restarting) shows the connection line, not "Request failed with status 502"', async () => {
    const failure = await gatewayError(502);
    const patchSettings = vi.fn(async () => { throw failure; });
    const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('10'));
    fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent("Couldn't save buffers. Check your connection and try again."));
  });

  describe('typed values are validated as typed', () => {
    const load = async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings(), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('5'));
      return { patchSettings };
    };

    it('keeps a fractional value as typed and flags it instead of rounding it', async () => {
      const { patchSettings } = await load();
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '1.5' } });
      expect((screen.getByTestId('meeting-buffer') as HTMLInputElement).value).toBe('1.5');
      expect(screen.getByTestId('err-meetingBufferMs')).toHaveTextContent('Buffer must be a whole number of minutes (≥ 0)');
      expect(screen.getByTestId('save')).toBeDisabled();
      fireEvent.click(screen.getByTestId('save'));
      await new Promise((r) => setTimeout(r, 0));
      expect(patchSettings).not.toHaveBeenCalled();
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
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '-1' } });
      expect(screen.queryByTestId('saved')).not.toBeInTheDocument();
      expect(screen.getByTestId('save')).toBeDisabled();
    });
  });

  describe('settings that change while the page is open (another tab, realtime refetch)', () => {
    const mountWithServer = async (server: { current: Settings }) => {
      const patchSettings = vi.fn(async (patch: Partial<Settings>) => (server.current = { ...server.current, ...patch }));
      const api = fakeApiClient({ getSettings: async () => server.current, patchSettings } as never);
      let client!: QueryClient;
      renderWithProviders(<><Buffers /><GrabClient onClient={(c) => { client = c; }} /></>, { api });
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('5'));
      const refetch = async () => { await act(async () => { await client.invalidateQueries(); }); };
      return { patchSettings, refetch };
    };

    it('an untouched field follows the new value, an edited one is kept, and the next save sends only the edit', async () => {
      const server = { current: settings() }; // meeting 5, task 10
      const { patchSettings, refetch } = await mountWithServer(server);
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });

      server.current = settings({ meetingBufferMs: 1_200_000, taskBufferMs: 1_800_000 }); // another tab: 20 / 30
      await refetch();
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
      expect(valueOf('task-buffer')).toBe('15'); // the user's edit is never overwritten
      expect(screen.getByTestId('save')).toBeEnabled();

      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 900_000 });
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      expect(valueOf('meeting-buffer')).toBe('20');
      expect(screen.getByTestId('save')).toBeDisabled();
    });

    it('a re-seeded field is measured against the new value: typing the old one back can be saved', async () => {
      const server = { current: settings() };
      const { patchSettings, refetch } = await mountWithServer(server);
      server.current = settings({ meetingBufferMs: 1_200_000 });
      await refetch();
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
      expect(screen.getByTestId('save')).toBeDisabled(); // a re-seed is not an edit

      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '5' } });
      expect(screen.getByTestId('save')).toBeEnabled();
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledWith({ meetingBufferMs: 300_000 }));
    });

    it('a re-seed after a save keeps the Saved label (it is not a user edit)', async () => {
      const server = { current: settings() };
      const { refetch } = await mountWithServer(server);
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());

      server.current = { ...server.current, meetingBufferMs: 1_200_000 };
      await refetch();
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
      expect(screen.getByTestId('saved')).toBeInTheDocument();
      expect(screen.getByTestId('save')).toBeDisabled();
    });

    it('a field re-seeded while a save of the other is in flight is not marked edited when the save lands', async () => {
      let server = settings();
      let landSave!: () => void;
      const patchSettings = vi.fn((patch: Partial<Settings>) => new Promise<Settings>((resolve) => {
        landSave = () => { server = { ...server, ...patch }; resolve(server); };
      }));
      const api = fakeApiClient({ getSettings: async () => server, patchSettings } as never);
      let client!: QueryClient;
      renderWithProviders(<><Buffers /><GrabClient onClient={(c) => { client = c; }} /></>, { api });
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('5'));
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));

      server = { ...server, meetingBufferMs: 1_200_000 };
      await act(async () => { await client.invalidateQueries(); });
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
      await act(async () => { landSave(); });
      await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
      expect(valueOf('meeting-buffer')).toBe('20');
      expect(screen.getByTestId('save')).toBeDisabled();
    });

    it('an edited field is measured against what the server has now: typing the old value back after a refetch can be saved', async () => {
      const server = { current: settings() }; // 5 / 10
      const { patchSettings, refetch } = await mountWithServer(server);
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      // Another tab: task 30 (meeting 20 too, so the test can see the refetch land).
      server.current = settings({ meetingBufferMs: 1_200_000, taskBufferMs: 1_800_000, updatedAt: '2026-01-02T00:00:00.000Z' });
      await refetch();
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
      expect(valueOf('task-buffer')).toBe('15'); // the edit is kept
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '10' } });
      expect(screen.getByTestId('save')).toBeEnabled(); // 10 is not what the server has (30)
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 600_000 });
    });

    it('an edited field that now equals what the server has is no longer dirty and is not sent', async () => {
      const server = { current: settings() };
      const { patchSettings, refetch } = await mountWithServer(server);
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '30' } });
      server.current = settings({ taskBufferMs: 1_800_000, updatedAt: '2026-01-02T00:00:00.000Z' });
      await refetch();
      await waitFor(() => expect(screen.getByTestId('save')).toBeDisabled());
      expect(valueOf('task-buffer')).toBe('30');
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '7' } });
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      expect(patchSettings).toHaveBeenCalledWith({ meetingBufferMs: 420_000 });
    });

    describe('a save racing another tab\'s write converges to what the server has', () => {
      const at = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
      // meeting 5 / task 10 on load; the user saves task 15. The other tab's write also sets meeting
      // to 20, so a test can wait for its refetch to land (the edited task field shows no change).
      const race = async () => {
        let server = settings();
        let landSave!: (serverAfter: Settings) => void;
        const patchSettings = vi.fn((patch: Partial<Settings>) => new Promise<Settings>((resolve) => {
          landSave = (serverAfter) => { const response = { ...server, ...patch, updatedAt: at(3) }; server = serverAfter; resolve(response); };
        }));
        const api = fakeApiClient({ getSettings: async () => server, patchSettings } as never);
        let client!: QueryClient;
        renderWithProviders(<><Buffers /><GrabClient onClient={(c) => { client = c; }} /></>, { api });
        await waitFor(() => expect(valueOf('task-buffer')).toBe('10'));
        fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
        fireEvent.click(screen.getByTestId('save'));
        await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
        return {
          otherTabWrites: async (taskMs: number, n: number) => {
            server = settings({ meetingBufferMs: 1_200_000, taskBufferMs: taskMs, updatedAt: at(n) });
            await act(async () => { await client.invalidateQueries(); });
            await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
          },
          land: async (serverAfter: Settings) => {
            await act(async () => { landSave(serverAfter); });
            await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
          },
        };
      };

      it('their 30 arrives first, then our 15 lands last on the server → shows 15, clean', async () => {
        const r = await race();
        await r.otherTabWrites(1_800_000, 2);
        expect(valueOf('task-buffer')).toBe('15');
        await r.land(settings({ meetingBufferMs: 1_200_000, taskBufferMs: 900_000, updatedAt: at(3) }));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('15'));
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      it('their 30 arrives first and also lands last on the server → shows 30, clean', async () => {
        const r = await race();
        await r.otherTabWrites(1_800_000, 2);
        await r.land(settings({ meetingBufferMs: 1_200_000, taskBufferMs: 1_800_000, updatedAt: at(2) }));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('30'));
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      it('our save lands first, their 30 is written after it → shows 30, clean', async () => {
        const r = await race();
        await r.land(settings({ meetingBufferMs: 1_200_000, taskBufferMs: 1_800_000, updatedAt: at(4) }));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('30'));
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      // The refetch brings the same buffer values as on load (10) but a newer row: the page must still
      // notice, or it keeps showing 15 as saved.
      it('our save lands first, then the other tab sets the old value (10) back before our refetch → shows 10, clean', async () => {
        const r = await race();
        await r.land(settings({ taskBufferMs: 600_000, updatedAt: at(4) }));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('10'));
        expect(screen.getByTestId('save')).toBeDisabled();
      });
    });

    it('a refetch with identical data changes nothing', async () => {
      const server = { current: settings() };
      const { patchSettings, refetch } = await mountWithServer(server);
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      server.current = settings(); // same values, new object
      await refetch();
      expect(valueOf('meeting-buffer')).toBe('5');
      expect(valueOf('task-buffer')).toBe('15');
      expect(screen.getByTestId('save')).toBeEnabled();
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 900_000 }));
    });

    // The real server applies a PATCH when the request arrives and announces the write over the
    // realtime channel before it replies, so this tab's own write usually comes back as a refetch
    // while the save is still pending. A field can then leave the value it was sent over and come
    // back to it (15 arrives, then another tab sets the old 30 back) before the response lands.
    describe('a save whose own write is refetched before its response lands (as with the real server)', () => {
      const day = (n: number) => `2026-02-${String(n).padStart(2, '0')}T00:00:00.000Z`;
      const min = (n: number) => n * 60_000;

      const mountServer = async (start: Partial<Settings>) => {
        let version = 1;
        let row = settings({ ...start, updatedAt: day(version) });
        /** A write reaching the server (this tab's PATCH or another tab's): the row and updatedAt move on. */
        const write = (patch: Partial<Settings>) => { version += 1; row = { ...row, ...patch, updatedAt: day(version) }; return row; };
        // This tab's PATCH is applied on arrival; its response is held until `respond()`.
        let pendingResponse: (() => void) | null = null;
        const patchSettings = vi.fn((patch: Partial<Settings>) => {
          const after = write(patch);
          return new Promise<Settings>((resolve) => { pendingResponse = () => resolve(after); });
        });
        // A held GET reads the row when it is sent and answers when released (a slow refetch).
        let holdGets = false;
        let releaseGet: (() => void) | null = null;
        const getSettings = vi.fn(() => {
          const snapshot = row;
          if (!holdGets) return Promise.resolve(snapshot);
          return new Promise<Settings>((resolve) => { releaseGet = () => resolve(snapshot); });
        });
        const api = fakeApiClient({ getSettings, patchSettings } as never);
        let client!: QueryClient;
        renderWithProviders(<><Buffers /><GrabClient onClient={(c) => { client = c; }} /></>, { api });
        await waitFor(() => expect(valueOf('task-buffer')).toBe(String((row.taskBufferMs ?? 0) / 60_000)));
        // Waits a macrotask too: the query hands its update to React in a setTimeout(0) batch, and each
        // refetched row must render before the next write, as with a real realtime refetch.
        const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
        const refetch = async () => { await act(async () => { await client.invalidateQueries(); }); await tick(); };
        return {
          write, patchSettings, getSettings, refetch, tick,
          serverRow: () => row,
          /** Types into a field and saves; resolves once the PATCH has reached the server. */
          typeAndSave: async (id: string, value: string) => {
            const calls = patchSettings.mock.calls.length;
            fireEvent.change(screen.getByTestId(id), { target: { value } });
            fireEvent.click(screen.getByTestId('save'));
            await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(calls + 1));
          },
          /** The held response lands; then this save's own refetch settles. */
          respond: async () => {
            const gets = getSettings.mock.calls.length;
            await act(async () => { pendingResponse!(); });
            await waitFor(() => expect(screen.getByTestId('saved')).toBeInTheDocument());
            await waitFor(() => expect(getSettings.mock.calls.length).toBeGreaterThan(gets));
            await tick();
          },
          /** A refetch whose GET reads the row now but answers only on `releaseHeldGet()`. */
          startSlowRefetch: async () => {
            const gets = getSettings.mock.calls.length;
            holdGets = true;
            await act(async () => { void client.invalidateQueries(); });
            await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(gets + 1));
          },
          releaseHeldGet: async () => { holdGets = false; await act(async () => { releaseGet!(); }); await tick(); },
        };
      };

      /** Task 30 (or 10). This tab saves 15; its own write is refetched (15); the other tab sets the start value back. */
      const ownWriteThenOldValueBack = async (startMin: number) => {
        const t = await mountServer({ taskBufferMs: min(startMin) });
        await t.typeAndSave('task-buffer', '15');
        await t.refetch(); // the realtime event for this tab's own write: 15
        t.write({ taskBufferMs: min(startMin) }); // the other tab
        await t.refetch();
        await waitFor(() => expect(valueOf('task-buffer')).toBe(String(startMin)));
        await t.respond();
        return t;
      };

      it('the other tab sets 30 back while our 15 is pending → shows 30 with nothing to save', async () => {
        await ownWriteThenOldValueBack(30);
        expect(valueOf('task-buffer')).toBe('30');
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      it('the other tab sets 10 back while our 15 is pending → shows 10 with nothing to save', async () => {
        await ownWriteThenOldValueBack(10);
        expect(valueOf('task-buffer')).toBe('10');
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      it('after that, a later save of the other field alone does not send the task value back over a newer one', async () => {
        const t = await ownWriteThenOldValueBack(30);
        t.write({ taskBufferMs: min(40) }); // the other tab again
        await t.refetch();
        await t.typeAndSave('meeting-buffer', '7');
        expect(t.patchSettings).toHaveBeenLastCalledWith({ meetingBufferMs: min(7) });
        expect(t.serverRow().taskBufferMs).toBe(min(40));
        expect(valueOf('task-buffer')).toBe('40');
      });

      it('after that, Save stays disabled with nothing typed, so a bare click sends nothing', async () => {
        const t = await ownWriteThenOldValueBack(30);
        t.write({ taskBufferMs: min(40) });
        await t.refetch();
        expect(screen.getByTestId('save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('save'));
        await t.tick();
        expect(t.patchSettings).toHaveBeenCalledTimes(1);
        expect(valueOf('task-buffer')).toBe('40');
      });

      it('the meeting field behaves the same: a later task-only save does not send the meeting value back over a newer one', async () => {
        const t = await mountServer({});
        await t.typeAndSave('meeting-buffer', '8');
        await t.refetch(); // own write: 8
        t.write({ meetingBufferMs: min(5) }); // the other tab sets 5 back
        await t.refetch();
        await waitFor(() => expect(valueOf('meeting-buffer')).toBe('5'));
        await t.respond();
        t.write({ meetingBufferMs: min(12) });
        await t.refetch();
        await t.typeAndSave('task-buffer', '20');
        expect(t.patchSettings).toHaveBeenLastCalledWith({ taskBufferMs: min(20) });
        expect(t.serverRow().meetingBufferMs).toBe(min(12));
        expect(valueOf('meeting-buffer')).toBe('12');
      });

      // The own write's refetch never renders on its own: the next thing seen is the other tab's 30
      // (it also sets meeting 20, so the test can see it land).
      it('our 15 is overwritten by the other tab\'s 30 before we see it → ends showing 30, not 15 as saved', async () => {
        const t = await mountServer({ taskBufferMs: min(30) });
        await t.typeAndSave('task-buffer', '15');
        t.write({ meetingBufferMs: min(20), taskBufferMs: min(30) });
        await t.refetch();
        await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
        await t.respond();
        expect(t.serverRow().taskBufferMs).toBe(min(30));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('30'));
        expect(screen.getByTestId('save')).toBeDisabled();
      });

      // A refetch sent before our PATCH reached the server (it carries the other tab's meeting 20 and
      // the old task 10) lands while the save is pending. The task field may show 10 for a moment;
      // this save's own refetch then settles it on what the server has: the 15 just saved.
      it('a slow refetch from before our save, changing only the other field, lands while it is pending → ends showing the value just saved', async () => {
        const t = await mountServer({});
        t.write({ meetingBufferMs: min(20) }); // the other tab
        await t.startSlowRefetch(); // its realtime refetch, slow: reads meeting 20 / task 10
        await t.typeAndSave('task-buffer', '15');
        await t.releaseHeldGet();
        await waitFor(() => expect(valueOf('meeting-buffer')).toBe('20'));
        await t.respond();
        expect(t.serverRow().taskBufferMs).toBe(min(15));
        await waitFor(() => expect(valueOf('task-buffer')).toBe('15'));
        expect(valueOf('meeting-buffer')).toBe('20');
        expect(screen.getByTestId('save')).toBeDisabled();
      });
    });
  });

  describe('only the fields that will be sent are validated', () => {
    // 30 h, stored before the 24 h cap existed: shown as 1800 with its error.
    const OVER_CAP_MS = 1800 * 60_000;

    it('an untouched invalid buffer does not block saving the other, and keeps its error on screen', async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings({ meetingBufferMs: OVER_CAP_MS }), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('1800'));
      expect(screen.getByTestId('err-meetingBufferMs')).toHaveTextContent('Buffer must be at most 24 hours (1440 min)');

      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      expect(screen.getByTestId('save')).toBeEnabled();
      expect(screen.getByTestId('err-meetingBufferMs')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('save'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      expect(patchSettings).toHaveBeenCalledWith({ taskBufferMs: 900_000 });
    });

    it('an edited invalid buffer still blocks saving', async () => {
      const patchSettings = vi.fn(async () => settings());
      const api = fakeApiClient({ getSettings: async () => settings({ meetingBufferMs: OVER_CAP_MS }), patchSettings } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect(valueOf('meeting-buffer')).toBe('1800'));
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '1500' } });
      expect(screen.getByTestId('save')).toBeDisabled();
    });

    it('first-time setup sends both buffers, so an invalid one blocks saving even if only the other was edited last', async () => {
      const putSettings = vi.fn(async () => settings());
      const api = fakeApiClient({
        getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'not found')), putSettings,
      } as never);
      renderWithProviders(<Buffers />, { api });
      await waitFor(() => expect(screen.getByTestId('task-buffer')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('meeting-buffer'), { target: { value: '-1' } });
      fireEvent.change(screen.getByTestId('task-buffer'), { target: { value: '15' } });
      expect(screen.getByTestId('save')).toBeDisabled();
    });
  });
});
