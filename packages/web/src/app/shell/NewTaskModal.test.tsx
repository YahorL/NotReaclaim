import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from './NewTaskModal';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const task = (over: Partial<Task> = {}): Task => ({
  id: 't9', userId: 'u1', title: 'x', priority: 4, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
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
});
