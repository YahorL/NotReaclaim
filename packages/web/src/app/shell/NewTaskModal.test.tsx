import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from './NewTaskModal';
import { installMatchMedia } from '../../test/matchMedia';
import { REDUCED_MOTION_QUERY } from '../../theme/usePrefersReducedMotion';

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
    fireEvent.click(screen.getByRole('radio', { name: /high/i }));
    expect(screen.getByRole('radio', { name: /high/i })).toHaveAttribute('aria-checked', 'true');
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
    fireEvent.click(screen.getByRole('checkbox', { name: /split up/i }));
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
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const backdrop = screen.getByTestId('new-task-backdrop');
    // Fluid up to 600px (prototype `.modal`), never a fixed width that overflows a 390px viewport.
    expect(dialog.classList.contains('w-full')).toBe(true);
    expect(dialog.classList.contains('max-w-[600px]')).toBe(true);
    expect(dialog.classList.contains('w-[600px]')).toBe(false);
    // Backdrop padding keeps the dialog off the viewport edges…
    expect(backdrop.classList.contains('px-4')).toBe(true);
    // …and the backdrop scrolls, so Create/Cancel stay reachable on short viewports.
    expect(backdrop.classList.contains('overflow-y-auto')).toBe(true);
  });

  it('reserves the mobile bar height below md and the desktop bar at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const backdrop = screen.getByTestId('new-task-backdrop');
    // MobileTopBar is h-14 (56px); pt-[70px] was a desktop-TopBar constant, ~14px too tall here.
    expect(backdrop.classList.contains('pt-14')).toBe(true);
    expect(backdrop.classList.contains('md:pt-[70px]')).toBe(true);
    expect(backdrop.classList.contains('pt-[70px]')).toBe(false);
  });

  it('goes near-full-screen below md and keeps its natural height at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(dialog.classList.contains('min-h-[calc(100dvh_-_88px)]')).toBe(true);
    expect(dialog.classList.contains('md:min-h-0')).toBe(true);
  });

  it('stacks the Duration | Priority pair on a phone and puts them side by side from sm', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    // A 2×2 picker beside a stepper needs ~480px; the content box at 390 is ~314px. The prototype
    // stacks at ≤560px; from sm (640) the dialog is 600px wide and both halves fit.
    const row = screen.getByRole('radiogroup', { name: 'Priority' }).closest('[data-testid="duration-priority-row"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.classList.contains('grid-cols-1')).toBe(true);
    expect(row.classList.contains('sm:grid-cols-2')).toBe(true);
  });

  it('stacks the Min/Max duration pair on a phone and puts them side by side from sm', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const row = screen.getByTestId('chunk-row');
    expect(row).toContainElement(screen.getByText('Min duration'));
    expect(row.classList.contains('grid-cols-1')).toBe(true);
    expect(row.classList.contains('sm:grid-cols-2')).toBe(true);
  });
});

describe('NewTaskModal dialog structure and closing', () => {
  const render = (onClose = vi.fn(), createTask = vi.fn(async () => task())) => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={onClose} />, { api: fakeApiClient(api(createTask) as never) });
    return { onClose, createTask };
  };

  it('is a modal dialog labelled by its "New task" heading', () => {
    render();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByRole('heading', { level: 2, name: 'New task' });
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('focuses the task name field on open and names it', () => {
    render();
    const name = screen.getByRole('textbox', { name: 'Task name' });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('placeholder', 'Task name…');
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(screen.getByRole('textbox', { name: 'Task name' }), { key: 'Escape' })],
    ['✕', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['the backdrop', () => fireEvent.click(screen.getByTestId('new-task-backdrop'))],
  ])('%s plays the exit animation, then closes once', async (_how, act) => {
    const { onClose, createTask } = render();
    act();
    // Exit first: the dialog stays mounted (data-closing) for the 220ms modal-out.
    expect(screen.getByRole('dialog', { name: 'New task' })).toHaveAttribute('data-closing', 'true');
    expect(screen.getByTestId('new-task-backdrop')).toHaveAttribute('data-closing', 'true');
    expect(onClose).not.toHaveBeenCalled();
    // A second close request during the exit is ignored.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createTask).not.toHaveBeenCalled();
  });

  it('a click inside the dialog does not close it', async () => {
    const { onClose } = render();
    fireEvent.click(screen.getByRole('dialog', { name: 'New task' }));
    fireEvent.click(screen.getByText('Hours'));
    await new Promise((r) => setTimeout(r, 300));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New task' })).not.toHaveAttribute('data-closing');
  });

  it('closes at once under reduced motion', () => {
    const mm = installMatchMedia({ [REDUCED_MOTION_QUERY]: true });
    try {
      const { onClose } = render();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally { mm.restore(); }
  });

  it('Enter in the name field creates the task when valid', async () => {
    const { onClose, createTask } = render();
    const name = screen.getByRole('textbox', { name: 'Task name' });
    fireEvent.keyDown(name, { key: 'Enter' }); // empty: nothing
    expect(createTask).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Write spec' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.keyDown(name, { key: 'Enter' }); // a repeat while the create is in flight is ignored
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Enter while an IME composition is open does not submit', () => {
    const { createTask } = render();
    const name = screen.getByRole('textbox', { name: 'Task name' });
    fireEvent.change(name, { target: { value: 'にほん' } });
    fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('Enter in the new-category field adds the category instead of creating the task', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-new', userId: 'u', name: 'Deep', windows: [], isDefault: false });
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, {
      api: fakeApiClient({ ...api(createTask), listCategories: vi.fn().mockResolvedValue([]), createCategory } as never),
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Task name' }), { target: { value: 'Write' } });
    fireEvent.click(screen.getByTestId('new-category-btn'));
    fireEvent.change(screen.getByTestId('new-category-name'), { target: { value: 'Deep' } });
    fireEvent.keyDown(screen.getByTestId('new-category-name'), { key: 'Enter' });
    await waitFor(() => expect(createCategory).toHaveBeenCalledTimes(1));
    expect(createTask).not.toHaveBeenCalled();
  });

  it('Create stays disabled until the name has non-blank text', () => {
    render();
    const create = screen.getByRole('button', { name: /^create$/i });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Task name' }), { target: { value: '   ' } });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Task name' }), { target: { value: 'x' } });
    expect(create).toBeEnabled();
  });

  it('Split up is a checkbox (on by default) that reveals Min/Max; off removes them', () => {
    render();
    const split = screen.getByRole('checkbox', { name: 'Split up' });
    expect(split).toBeChecked();
    expect(split).toHaveAccessibleDescription(/spread this task over several blocks/i);
    expect(screen.getByTestId('chunk-row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'increase min' })).toBeEnabled();
    fireEvent.click(split);
    expect(split).not.toBeChecked();
    expect(screen.queryByTestId('chunk-row')).toBeNull();
    expect(screen.queryByRole('button', { name: 'increase min' })).toBeNull();
    fireEvent.click(split);
    expect(screen.getByRole('button', { name: 'increase max' })).toBeInTheDocument();
  });

  it('traps Tab inside the dialog', () => {
    render();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(close);
  });

  it('returns focus to the opener passed by the shell once closed', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'New task';
    document.body.appendChild(opener);
    const ref = { current: opener };
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(<NewTaskModal now={() => NOW} onClose={onClose} opener={ref} />, { api: fakeApiClient(api() as never) });
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
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
    fireEvent.click(screen.getByRole('checkbox', { name: /split up/i }));
    resolve();
    // Split off renders no chunk steppers, so peek (on, then off again) to know settings landed.
    fireEvent.click(screen.getByRole('checkbox', { name: /split up/i }));
    await waitFor(() => expect(screen.getByText('45 mins')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /split up/i }));
    expect(screen.queryByText('45 mins')).toBeNull();
    create();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })));
    fireEvent.click(screen.getByRole('checkbox', { name: /split up/i }));
    expect(screen.getByRole('button', { name: 'increase min' })).not.toBeDisabled();
    expect(screen.getByText('45 mins')).toBeInTheDocument();
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
  });
});
