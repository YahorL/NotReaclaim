import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { CreatePopover } from './CreatePopover';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight, TZ=UTC
const baseProps = { dayStartMs: DAY, startMin: 540, topPct: 18.75, onClose: vi.fn() }; // 09:00

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
});
