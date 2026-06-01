import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';
import { HoursByDayChart } from './HoursByDayChart';
import { TimeSplitDonut } from './TimeSplitDonut';
import { HOUR_MS, type KindMs, type DonutSegment } from './statsModel';

describe('StatCard', () => {
  it('renders label, value, sub and the accent class', () => {
    render(<StatCard label="Total scheduled" value="34h" sub="this week" accent="text-indigo" />);
    const card = screen.getByTestId('stat-card');
    expect(card).toHaveTextContent('Total scheduled');
    expect(card).toHaveTextContent('34h');
    expect(card).toHaveTextContent('this week');
    expect(card.querySelector('.text-indigo')).not.toBeNull();
  });
});

describe('HoursByDayChart', () => {
  it('renders 7 day labels and scales a busy day bar to px height', () => {
    const perDay: KindMs[] = Array.from({ length: 7 }, () => ({ task: 0, meeting: 0, habit: 0 }));
    perDay[0] = { task: 4 * HOUR_MS, meeting: 0, habit: 0 }; // 4h on a max(8h) scale → 100px
    render(<HoursByDayChart perDay={perDay} dayLabels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} />);
    expect(screen.getByTestId('hours-by-day')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
    const bars = screen.getAllByTestId('bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute('data-kind', 'task');
    expect(bars[0]!.style.height).toBe('100px');
  });
});

describe('TimeSplitDonut', () => {
  it('renders the legend hours and center total', () => {
    const segments: DonutSegment[] = [
      { kind: 'task', ms: 2 * HOUR_MS, fromPct: 0, toPct: 50 },
      { kind: 'meeting', ms: HOUR_MS, fromPct: 50, toPct: 75 },
      { kind: 'habit', ms: HOUR_MS, fromPct: 75, toPct: 100 },
    ];
    render(<TimeSplitDonut segments={segments} totalMs={4 * HOUR_MS} />);
    expect(screen.getByText('task')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument(); // center total
  });

  it('shows an empty message when there are no segments', () => {
    render(<TimeSplitDonut segments={[]} totalMs={0} />);
    expect(screen.getByText(/no scheduled time yet/i)).toBeInTheDocument();
  });
});
