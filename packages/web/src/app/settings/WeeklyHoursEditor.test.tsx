import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import type { DayState } from './weeklyHours';

const days = (): DayState[] => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday, enabled: weekday >= 1 && weekday <= 5, start: '06:00', end: '18:00',
}));

describe('WeeklyHoursEditor', () => {
  it('gives the time inputs a phone-width row (narrow day column, tight gaps) and widens from sm', () => {
    // Found live at 390px: with the 72px day column, 10px gaps and 16px editor padding each time
    // input was ~83px and Chromium clipped "09:00 AM" to "09:0".
    for (const showCoverage of [false, true]) {
      const { unmount } = render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} showCoverage={showCoverage} />);
      const row = screen.getByTestId('day-1-row');
      expect(row.className).toContain('grid-cols-[64px_minmax(0,1fr)_8px_minmax(0,1fr)]');
      expect(row.className).toContain('gap-1.5');
      expect(row.className).toContain('sm:gap-2.5');
      expect(screen.getByTestId('day-1-start').className).toContain('px-1.5');
      expect(screen.getByTestId('day-1-start').className).toContain('sm:px-2.5');
      expect(screen.getByTestId('day-1-start').className).toContain('max-sm:[&::-webkit-calendar-picker-indicator]:hidden');
      unmount();
    }
  });

  it('lists Monday first and names every control after its day', () => {
    render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} />);
    const toggles = screen.getAllByRole('checkbox');
    expect(toggles).toHaveLength(7);
    expect(toggles[0]).toHaveAccessibleName('Mon');
    expect(toggles[6]).toHaveAccessibleName('Sun');
    expect(screen.getByLabelText('Monday start time')).toBe(screen.getByTestId('day-1-start'));
    expect(screen.getByLabelText('Sunday end time')).toBe(screen.getByTestId('day-0-end'));
  });

  it('clicking the day name toggles the day', () => {
    const onChange = vi.fn();
    render(<WeeklyHoursEditor days={days()} onChange={onChange} />);
    fireEvent.click(screen.getByText('Sat'));
    expect(onChange).toHaveBeenCalledWith(6, { enabled: true });
  });

  it('disables the times of an off day and marks the row', () => {
    render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} />);
    expect(screen.getByTestId('day-0-start')).toBeDisabled();
    expect(screen.getByTestId('day-0-row')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('day-1-start')).not.toBeDisabled();
  });

  it('draws no coverage bar unless asked (Settings)', () => {
    render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} />);
    expect(screen.queryByTestId('day-1-bar')).toBeNull();
    expect(screen.queryByTestId('day-ticks')).toBeNull();
  });

  it('with coverage: each bar spans its window on the 24h axis and follows edits', () => {
    const d = days();
    const { rerender } = render(<WeeklyHoursEditor days={d} onChange={vi.fn()} showCoverage idPrefix="cat-x" />);
    const bar = screen.getByTestId('cat-x-1-bar');
    expect(bar.style.left).toBe('25%');
    expect(bar.style.width).toBe('50%');
    expect(screen.getByTestId('cat-x-ticks')).toHaveTextContent('12a6a12p6p12a');
    rerender(<WeeklyHoursEditor days={d.map((x) => (x.weekday === 1 ? { ...x, end: '12:00' } : x))} onChange={vi.fn()} showCoverage idPrefix="cat-x" />);
    expect(screen.getByTestId('cat-x-1-bar').style.width).toBe('25%');
  });

  it('an inverted window shows an empty bar, not a negative one', () => {
    const d = days().map((x) => (x.weekday === 2 ? { ...x, start: '18:00', end: '06:00' } : x));
    render(<WeeklyHoursEditor days={d} onChange={vi.fn()} showCoverage />);
    expect(screen.getByTestId('day-2-bar').style.width).toBe('0%');
  });

  it('paints the bar in the category colour when one is set', () => {
    render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} showCoverage coverageColor="#4285f4" />);
    expect(screen.getByTestId('day-1-bar').style.backgroundColor).toBe('rgb(66, 133, 244)');
  });

  it('shows a per-day error on its own line', () => {
    render(<WeeklyHoursEditor days={days()} onChange={vi.fn()} errors={{ 3: 'End must be after start' }} />);
    expect(screen.getByTestId('err-day-3')).toHaveTextContent('End must be after start');
  });
});
