import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { HabitRow } from './HabitRow';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Partial<Habit> = {}) {
  const onEdit = vi.fn(); const onToggleStatus = vi.fn(); const onDelete = vi.fn();
  render(<HabitRow habit={habit(over)} onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />);
  return { onEdit, onToggleStatus, onDelete };
}

describe('HabitRow', () => {
  it('renders chunk × per-week and eligible days', () => {
    setup();
    const row = screen.getByTestId('habit-row');
    expect(row).toHaveTextContent('Run');
    expect(row).toHaveTextContent('30m × 4/week');
    expect(row).toHaveTextContent('Mon');
  });

  it('pause toggles status (active → resume label when paused)', () => {
    const { onToggleStatus } = setup();
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
  });

  it('shows resume for a paused habit', () => {
    setup({ status: 'paused' });
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
  });

  it('delete requires inline confirm', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
