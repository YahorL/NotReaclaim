import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Habit } from '../../api/types';
import { HabitDrawer } from './HabitDrawer';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', userId: 'u1', title: 'Run', priority: 2, chunkMs: 1_800_000, perPeriod: 4,
  periodType: 'week', preferredStartMinute: null, preferredEndMinute: null, eligibleDays: [1, 3, 5],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('HabitDrawer', () => {
  it('prefills and saves a converted patch', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit()} onSave={onSave} onCancel={vi.fn()} />);
    // DurationStepper renders the human label instead of h/m inputs
    expect(screen.getByText('30 mins')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Run', chunkMs: 1_800_000, perPeriod: 4, eligibleDays: [1, 3, 5], status: 'active' }));
  });

  it('toggling a day updates eligibleDays', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-0')); // add Sunday
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ eligibleDays: expect.arrayContaining([0, 1, 3, 5]) }));
  });

  it('blocks save when no day is selected', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit({ eligibleDays: [1] })} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-1')); // remove the only day
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-eligibleDays')).toBeInTheDocument();
  });

  it('chunk stepper decrease/increase adjusts chunkMs in 15-min steps', () => {
    const onSave = vi.fn();
    render(<HabitDrawer habit={habit()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'increase chunk' }));
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chunkMs: 1_800_000 + 15 * 60_000 }));
  });

  it('drawer root has w-[440px] class', () => {
    render(<HabitDrawer habit={habit()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('habit-drawer').className).toContain('w-[440px]');
  });

  it('drawer has max-h overflow-y-auto for scroll safety', () => {
    render(<HabitDrawer habit={habit()} onSave={vi.fn()} onCancel={vi.fn()} />);
    const drawer = screen.getByTestId('habit-drawer');
    expect(drawer.className).toMatch(/max-h-\[calc/);
    expect(drawer.className).toContain('overflow-y-auto');
  });
});
