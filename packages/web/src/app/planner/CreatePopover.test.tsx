import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { CreatePopover } from './CreatePopover';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight, TZ=UTC
const baseProps = { dayStartMs: DAY, startMin: 540, topPct: 18.75, onClose: vi.fn() }; // 09:00

const fakeCategories = [
  { id: 'cat-default', userId: 'u1', name: 'Work', windows: null, isDefault: true, color: null },
  { id: 'cat-other', userId: 'u1', name: 'Personal', windows: null, isDefault: false, color: null },
];

describe('CreatePopover', () => {
  it('shows the snapped slot label and defaults to a 30-min event', () => {
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient() });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    expect(screen.getByTestId('slot-label').textContent).toMatch(/09:00.*09:30/);
  });

  it('creates an event and closes', async () => {
    const onClose = vi.fn();
    const createCalendarEvent = vi.fn(async () => ({ id: 'e1' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ createCalendarEvent } as never) });
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Standup' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledWith({
      title: 'Standup', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates a task pinned at the slot (min=max=duration, dueBy end of day, priority 4)', async () => {
    const onClose = vi.fn();
    const createTask = vi.fn(async () => ({ id: 't-9' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-9' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Deep work' } });
    fireEvent.click(screen.getByRole('button', { name: 'increase slot' })); // 30 → 45 min
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deep work', durationMs: 2_700_000, minChunkMs: 2_700_000, maxChunkMs: 2_700_000, priority: 4,
      dueBy: new Date(DAY + (23 * 60 + 59) * 60_000).toISOString(),
    })));
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't-9', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:45:00.000Z',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('disables Create on an empty title and closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient() });
    expect(screen.getByTestId('create-submit')).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('caps the duration so the slot cannot extend past the 22:00 window end', () => {
    renderWithProviders(<CreatePopover {...baseProps} startMin={1305} />, { api: fakeApiClient() });
    expect(screen.getByTestId('slot-label').textContent).toMatch(/09:45 PM.*10:00 PM|21:45.*22:00/); // 21:45 – 22:00 (15 min max)
    fireEvent.click(screen.getByRole('button', { name: 'increase slot' }));
    expect(screen.getByTestId('slot-label').textContent).toMatch(/09:45 PM.*10:00 PM|21:45.*22:00/); // still capped at 15 min
  });

  it('pins an existing task at the slot instead of creating a new one', async () => {
    const onClose = vi.fn();
    const listTasks = vi.fn(async () => [
      { id: 't1', userId: 'u1', title: 'Existing job', priority: 2, durationMs: 3_600_000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' },
      { id: 't2', userId: 'u1', title: 'Done job', priority: 2, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'completed', timeLoggedMs: 0, createdAt: '', updatedAt: '' },
    ]);
    const createTask = vi.fn();
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-1' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ listTasks, createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Existing job' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Done job' })).not.toBeInTheDocument(); // completed filtered out
    fireEvent.change(screen.getByTestId('task-select'), { target: { value: 't1' } });
    expect(screen.queryByTestId('create-title')).not.toBeInTheDocument(); // title hidden for existing
    const submit = screen.getByTestId('create-submit');
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveTextContent(/schedule task/i);
    fireEvent.click(submit);
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    }));
    expect(createTask).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('picker defaults to "new task" and keeps the create flow', async () => {
    const listTasks = vi.fn(async () => []);
    const createTask = vi.fn(async () => ({ id: 't-9' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-9' }));
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ listTasks, createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    expect((screen.getByTestId('task-select') as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('create-title')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
  });

  it('default align renders left-1 class', () => {
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    expect(popover.className).toContain('left-1');
    expect(popover.className).not.toContain('right-1');
  });

  it('align="right" renders right-1 and not left-1', () => {
    renderWithProviders(<CreatePopover {...baseProps} align="right" />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    expect(popover.className).toContain('right-1');
    expect(popover.className).not.toContain('left-1');
  });

  it('popover has w-[340px] width class', () => {
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    expect(popover.className).toContain('w-[340px]');
  });

  // --- Task 1: new task fields ---

  it('task mode (new task) shows due/category/after fields; event mode hides them', async () => {
    const listCategories = vi.fn(async () => fakeCategories);
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ listCategories } as never) });
    // event mode: fields absent
    expect(screen.queryByTestId('create-due')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-category')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-after')).not.toBeInTheDocument();
    // switch to task mode
    fireEvent.click(screen.getByTestId('mode-task'));
    // due date prefilled to 2026-01-05T23:59
    const dueInput = screen.getByTestId('create-due') as HTMLInputElement;
    expect(dueInput).toBeInTheDocument();
    expect(dueInput.value).toBe('2026-01-05T23:59');
    // after defaults to empty
    const afterInput = screen.getByTestId('create-after') as HTMLInputElement;
    expect(afterInput).toBeInTheDocument();
    expect(afterInput.value).toBe('');
    // category select present
    expect(screen.getByTestId('create-category')).toBeInTheDocument();
  });

  it('task mode: existing-task selection hides due/category/after fields', async () => {
    const listTasks = vi.fn(async () => [
      { id: 't1', userId: 'u1', title: 'Some task', priority: 2, durationMs: 3_600_000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' },
    ]);
    const listCategories = vi.fn(async () => fakeCategories);
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ listTasks, listCategories } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    // wait for task to load
    await waitFor(() => expect(screen.getByRole('option', { name: 'Some task' })).toBeInTheDocument());
    // new-task fields visible before selecting
    expect(screen.getByTestId('create-due')).toBeInTheDocument();
    // select existing task
    fireEvent.change(screen.getByTestId('task-select'), { target: { value: 't1' } });
    // fields hidden when existing task selected
    expect(screen.queryByTestId('create-due')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-category')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-after')).not.toBeInTheDocument();
  });

  it('category select default-selects the isDefault category once loaded', async () => {
    const listCategories = vi.fn(async () => fakeCategories);
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ listCategories } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    await waitFor(() => {
      const sel = screen.getByTestId('create-category') as HTMLSelectElement;
      expect(sel.value).toBe('cat-default');
    });
  });

  it('submitting with edited due/after/category sends them in the createTask payload', async () => {
    const onClose = vi.fn();
    const createTask = vi.fn(async () => ({ id: 't-new' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-new' }));
    const listCategories = vi.fn(async () => fakeCategories);
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, {
      api: fakeApiClient({ createTask, createScheduledBlock, listCategories } as never),
    });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Focused block' } });
    // wait for category to load and default-select
    await waitFor(() => {
      const sel = screen.getByTestId('create-category') as HTMLSelectElement;
      expect(sel.value).toBe('cat-default');
    });
    // change due date
    fireEvent.change(screen.getByTestId('create-due'), { target: { value: '2026-01-06T12:00' } });
    // set schedule after
    fireEvent.change(screen.getByTestId('create-after'), { target: { value: '2026-01-05T10:00' } });
    // change category
    fireEvent.change(screen.getByTestId('create-category'), { target: { value: 'cat-other' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Focused block',
      dueBy: '2026-01-06T12:00:00.000Z',
      notBefore: '2026-01-05T10:00:00.000Z',
      categoryId: 'cat-other',
    })));
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't-new', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('submitting without editing the due date sends the default end-of-day ISO (unchanged existing test path)', async () => {
    // this mirrors the existing "creates a task pinned at the slot" test but verifies
    // the dueBy value even with the new fields wired in (no categories stub → empty select)
    const createTask = vi.fn(async () => ({ id: 't-x' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-x' }));
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Quick task' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      dueBy: new Date(DAY + (23 * 60 + 59) * 60_000).toISOString(),
    })));
  });

  it('categoryId is omitted from payload when no category is selected (categories unresolved)', async () => {
    const createTask = vi.fn(async () => ({ id: 't-y' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-y' }));
    // no listCategories stub → query rejects → categories empty
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'No cat' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => {
      const calls = createTask.mock.calls as unknown[][];
      const call = calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(call).toBeDefined();
      expect((call as Record<string, unknown>)['categoryId']).toBeUndefined();
    });
  });
});

describe('CreatePopover due-date guard', () => {
  it('Enter on the title does not submit when the due date is cleared', async () => {
    const createTask = vi.fn();
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient({ createTask, listCategories: vi.fn(async () => []) } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'No due' } });
    fireEvent.change(screen.getByTestId('create-due'), { target: { value: '' } });
    fireEvent.keyDown(screen.getByTestId('create-title'), { key: 'Enter' });
    expect(createTask).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-submit')).toBeDisabled();
  });
});
