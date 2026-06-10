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
});
