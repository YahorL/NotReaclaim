import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
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
