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
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings({ taskBufferMs: 3_600_000 }), putSettings } as never);
    renderWithProviders(<Buffers />, { api });
    await waitFor(() => expect((screen.getByTestId('task-buffer') as HTMLInputElement).value).toBe('60'));
    fireEvent.click(screen.getByRole('button', { name: 'Increase gap between tasks' }));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalledWith(expect.objectContaining({ taskBufferMs: 65 * 60_000 })));
  });

  it('labels each number field and describes it with its helper text', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<Buffers />, { api });
    const input = await screen.findByLabelText('Buffer around meetings');
    expect(input).toBe(screen.getByTestId('meeting-buffer'));
    expect(input).toHaveAccessibleDescription('Minutes kept free before and after each meeting');
  });

  it('shows "Unsaved changes" after an edit; a successful save swaps it for "Saved"; a later edit brings it back', async () => {
    const putSettings = vi.fn(async () => settings({ taskBufferMs: 900_000 }));
    // The refetch after the save still returns the old values: the status must not depend on it.
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
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
    const putSettings = vi.fn().mockRejectedValue(new ApiError(400, 'validation_error', 'nope'));
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
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
});
