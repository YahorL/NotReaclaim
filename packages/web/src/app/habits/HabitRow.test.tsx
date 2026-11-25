import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { HabitRow } from './HabitRow';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Partial<Habit> = {}, unscheduledCount = 0) {
  const onEdit = vi.fn(); const onToggleStatus = vi.fn(); const onDelete = vi.fn();
  render(
    <HabitRow habit={habit(over)} unscheduledCount={unscheduledCount}
      onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />,
  );
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

  it('shows an at-risk chip only when occurrences went unscheduled', () => {
    setup();
    expect(screen.queryByTestId('habit-at-risk')).toBeNull();
    setup({}, 3);
    const chip = screen.getByTestId('habit-at-risk');
    expect(chip).toHaveAttribute('title', "3 occurrences couldn't be scheduled in the planning horizon");
  });

  it('says "occurrence" for a single miss', () => {
    setup({}, 1);
    expect(screen.getByTestId('habit-at-risk')).toHaveAttribute('title', "1 occurrence couldn't be scheduled in the planning horizon");
  });

  it('delete requires inline confirm', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Run' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows seven read-only day pills with the eligible ones on, and says the days in text', () => {
    setup();
    const pills = screen.getAllByTestId('habit-day');
    expect(pills.map((p) => p.textContent).join('')).toBe('SMTWTFS');
    expect(pills.map((p) => p.getAttribute('data-on'))).toEqual(['false', 'true', 'false', 'true', 'false', 'true', 'false']);
    pills.forEach((p) => expect(p).toHaveAttribute('aria-hidden', 'true'));
    expect(screen.getByTestId('habit-days')).toHaveTextContent('Days: Mon, Wed, Fri');
    // the pills are display only
    expect(screen.queryByRole('button', { name: 'M' })).toBeNull();
  });

  it('reads "any day" when every day is eligible', () => {
    setup({ eligibleDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(screen.getByTestId('habit-row')).toHaveTextContent('30m × 4/week · any day');
    expect(screen.getByTestId('habit-days')).toHaveTextContent('Days: any day');
  });

  it('marks a paused habit with a chip and dims the row', () => {
    setup({ status: 'paused' });
    expect(screen.getByTestId('habit-paused')).toHaveTextContent('Paused');
    expect(screen.getByTestId('habit-row')).toHaveAttribute('data-paused', 'true');
    setup();
    expect(screen.getAllByTestId('habit-row')[1]).toHaveAttribute('data-paused', 'false');
  });

  it('dims a paused habit\'s text with contrast-safe tokens, never the whole row (buttons stay full strength)', () => {
    setup({ status: 'paused' });
    const row = screen.getByTestId('habit-row');
    // A row-wide opacity took the meta text to ~2.5:1 and the Edit / Resume buttons under 4.5:1.
    expect(row.className).not.toMatch(/(^|\s)opacity-/);
    expect(screen.getByText('Run')).toHaveClass('text-fg-2');
    for (const pill of screen.getAllByTestId('habit-day')) expect(pill.className).not.toContain('text-accent-fg');
  });

  it('the at-risk chip states the missed count in text', () => {
    setup({}, 2);
    expect(screen.getByTestId('habit-at-risk')).toHaveTextContent('2 missed');
  });

  it('cancel in the inline confirm keeps the habit', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete Run' })).toBeInTheDocument();
  });
});
