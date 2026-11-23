import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from './NewTaskModal';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const task = (over: Partial<Task> = {}): Task => ({
  id: 't9', userId: 'u1', title: 'x', priority: 4, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function api(createTask = vi.fn(async () => task())) {
  return { createTask, getSettings: vi.fn(() => Promise.reject(new Error('404'))) };
}

describe('NewTaskModal', () => {
  it('creates a task with priority 4 from the entered name', async () => {
    const createTask = vi.fn(async () => task());
    const onClose = vi.fn();
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={onClose} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write spec' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec', priority: 4, durationMs: 3_600_000 })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates a task with the priority picked in the modal', async () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write spec' } });
    fireEvent.click(screen.getByRole('button', { name: /high/i }));
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec', priority: 2 })));
  });

  it('does not create when the name is empty (Create disabled)', () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('with Split off, sends min=max=duration', async () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Solid block' } });
    fireEvent.click(screen.getByRole('button', { name: /split up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })));
  });

  it('defaults to the default category and submits its id', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: 't1' });
    const api = fakeApiClient({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      listCategories: vi.fn().mockResolvedValue([
        { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
        { id: 'cat-p', userId: 'u', name: 'Personal', windows: [], isDefault: false },
      ]),
      createTask,
    } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

    fireEvent.change(await screen.findByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    await waitFor(() => expect(screen.getByTestId('category-select')).toHaveValue('cat-def'));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-def' })));
  });

  it('submits notBefore from the Schedule-after field', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: 't1' });
    const api = fakeApiClient({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      listCategories: vi.fn().mockResolvedValue([{ id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]),
      createTask,
    } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

    fireEvent.change(await screen.findByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: '2026-01-06T13:00' } });
    await waitFor(() => expect(screen.getByTestId('category-select')).toHaveValue('cat-def'));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ notBefore: new Date('2026-01-06T13:00').toISOString() })));
  });

  it('creates a new category and selects it', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-new', userId: 'u', name: 'Deep Work', windows: [], isDefault: false });
    const api = fakeApiClient({
      getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
      listCategories: vi.fn().mockResolvedValue([{ id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]),
      createCategory,
    } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

    fireEvent.click(await screen.findByTestId('new-category-btn'));
    fireEvent.change(screen.getByTestId('new-category-name'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('new-category-confirm'));
    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'Deep Work', windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] }));
    await waitFor(() => expect(screen.queryByTestId('new-category-name')).not.toBeInTheDocument());
  });

  it('sizes the dialog fluidly so it fits narrow viewports', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const dialog = screen.getByLabelText('Close').closest('div.animate-pop') as HTMLElement;
    const wrapper = dialog.parentElement as HTMLElement;

    // Fluid up to 500px, never a fixed 500px that overflows a 390px viewport.
    expect(dialog.classList.contains('w-full')).toBe(true);
    expect(dialog.classList.contains('max-w-[500px]')).toBe(true);
    expect(dialog.classList.contains('w-[500px]')).toBe(false);
    // Overlay padding keeps the dialog off the viewport edges.
    expect(wrapper.classList.contains('px-4')).toBe(true);
    // …and the overlay scrolls, so Create/Cancel stay reachable on short viewports.
    expect(wrapper.classList.contains('overflow-y-auto')).toBe(true);
  });

  it('reserves the mobile bar height below md and the desktop bar at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const wrapper = (screen.getByLabelText('Close').closest('div.animate-pop') as HTMLElement).parentElement!;
    // MobileTopBar is h-14 (56px); pt-[70px] was a desktop-TopBar constant, ~14px too tall here.
    expect(wrapper.classList.contains('pt-14')).toBe(true);
    expect(wrapper.classList.contains('md:pt-[70px]')).toBe(true);
    expect(wrapper.classList.contains('pt-[70px]')).toBe(false);
  });

  it('goes near-full-screen below md and keeps its natural height at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const dialog = screen.getByLabelText('Close').closest('div.animate-pop') as HTMLElement;
    expect(dialog.classList.contains('min-h-[calc(100dvh_-_88px)]')).toBe(true);
    expect(dialog.classList.contains('md:min-h-0')).toBe(true);
  });

  it('wraps the duration/priority/split row below md', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    // basis-[195px] + a shrink-0 2x2 picker + a shrink-0 Split toggle = ~429px of children in a
    // 358px content box at 390: the row must be allowed to break instead of clipping.
    const row = screen.getByRole('group', { name: 'Priority' }).closest('div.flex.flex-wrap') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.classList.contains('md:flex-nowrap')).toBe(true);
  });

  it('stacks the Min/Max duration pair below md and keeps the desktop row at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    // Two steppers with a 195px min in a 358px content box at 390: side by side they clip.
    const row = screen.getByText('Min duration').closest('div.mb-3\\.5') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.classList.contains('flex-col')).toBe(true);
    expect(row.classList.contains('md:flex-row')).toBe(true);
    expect(row.classList.contains('md:gap-4')).toBe(true);
  });
});

describe('NewTaskModal in the settings zone', () => {
  const NY_SETTINGS = { id: 's', userId: 'u', timezone: 'America/New_York', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' };
  // 02:00Z on Jan 7 is 21:00 on Jan 6 in New York.
  const NY_EVENING = Date.parse('2026-01-07T02:00:00.000Z');

  it('defaults and submits in the settings zone, not the browser zone', async () => {
    const createTask = vi.fn(async () => task());
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(NY_SETTINGS), createTask } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => NY_EVENING} />, { api });
    await waitFor(() => expect(screen.getByTestId('due-date')).toHaveValue('2026-01-13T23:59'));
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-01-06T08:00');
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: '2026-01-14T04:59:00.000Z', notBefore: '2026-01-06T13:00:00.000Z',
    })));
  });

  it('settings landing after the user edited a date keeps the edit and re-seeds the untouched default', async () => {
    let resolveSettings!: (s: unknown) => void;
    const getSettings = vi.fn(() => new Promise((r) => { resolveSettings = r; }));
    const createTask = vi.fn(async () => task());
    const api = fakeApiClient({ getSettings, createTask } as never);
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => NY_EVENING} />, { api });
    // Before settings: browser-zone (UTC in tests) fallback.
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-01-07T08:00');
    fireEvent.change(screen.getByTestId('due-date'), { target: { value: '2026-01-20T10:00' } });
    resolveSettings(NY_SETTINGS);
    await waitFor(() => expect(screen.getByTestId('schedule-after')).toHaveValue('2026-01-06T08:00'));
    expect(screen.getByTestId('due-date')).toHaveValue('2026-01-20T10:00');
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: '2026-01-20T15:00:00.000Z', notBefore: '2026-01-06T13:00:00.000Z',
    })));
  });
});

describe('NewTaskModal zone re-seed when the clock crossed midnight', () => {
  const TOKYO_SETTINGS = { id: 's', userId: 'u', timezone: 'Asia/Tokyo', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' };

  it('re-seeds the untouched defaults although "today" in the fallback zone moved since they were seeded', async () => {
    let clock = Date.parse('2026-01-05T23:59:00.000Z'); // opened at 23:59 in the (UTC) fallback zone
    let resolveSettings!: (s: unknown) => void;
    const getSettings = vi.fn(() => new Promise((r) => { resolveSettings = r; }));
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => clock} />, { api: fakeApiClient({ getSettings, createTask } as never) });
    expect(screen.getByTestId('due-date')).toHaveValue('2026-01-12T23:59');
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-01-05T08:00');
    clock = Date.parse('2026-01-06T00:01:00.000Z'); // settings arrive after midnight — Jan 6 09:01 in Tokyo
    resolveSettings(TOKYO_SETTINGS);
    await waitFor(() => expect(screen.getByTestId('due-date')).toHaveValue('2026-01-13T23:59'));
    expect(screen.getByTestId('schedule-after')).toHaveValue('2026-01-06T08:00');
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: '2026-01-13T14:59:00.000Z', notBefore: '2026-01-05T23:00:00.000Z',
    })));
  });
});

describe('NewTaskModal chunk defaults when settings land late', () => {
  // Non-default chunk sizes so the 30/120 built-in fallback is distinguishable.
  const SETTINGS = { id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 45 * 60_000, defaultMaxChunkMs: 90 * 60_000, createdAt: '', updatedAt: '' };

  function renderPending() {
    let resolveSettings!: (s: unknown) => void;
    const getSettings = vi.fn(() => new Promise((r) => { resolveSettings = r; }));
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal onClose={() => {}} now={() => NOW} />, { api: fakeApiClient({ getSettings, createTask } as never) });
    return { createTask, resolve: () => resolveSettings(SETTINGS) };
  }
  const create = () => {
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  };

  it('untouched chunk fields pick up the settings defaults and the create payload carries them', async () => {
    const { createTask, resolve } = renderPending();
    // Before settings: the built-in 30 / 120 fallback.
    expect(screen.getByText('30 mins')).toBeInTheDocument();
    expect(screen.getByText('2 hrs')).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.getByText('45 mins')).toBeInTheDocument());
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
    create();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 45 * 60_000, maxChunkMs: 90 * 60_000 })));
  });

  it('a chunk field the user edited before settings landed keeps the typed value', async () => {
    const { createTask, resolve } = renderPending();
    fireEvent.click(screen.getByRole('button', { name: 'increase max' })); // 120 → 135
    expect(screen.getByText('2 hr 15 min')).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.getByText('45 mins')).toBeInTheDocument());
    expect(screen.getByText('2 hr 15 min')).toBeInTheDocument();
    create();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 45 * 60_000, maxChunkMs: 135 * 60_000 })));
  });

  it('Split off: still sends min=max=duration after settings land, and toggling Split back on shows the settings defaults', async () => {
    const { createTask, resolve } = renderPending();
    fireEvent.click(screen.getByRole('button', { name: /split up/i }));
    resolve();
    await waitFor(() => expect(screen.getByText('45 mins')).toBeInTheDocument());
    create();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })));
    fireEvent.click(screen.getByRole('button', { name: /split up/i }));
    expect(screen.getByRole('button', { name: 'increase min' })).not.toBeDisabled();
    expect(screen.getByText('45 mins')).toBeInTheDocument();
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
  });
});
