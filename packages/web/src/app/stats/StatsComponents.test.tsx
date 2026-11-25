import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StatCard } from './StatCard';
import { HoursByDayChart } from './HoursByDayChart';
import { TimeSplitDonut } from './TimeSplitDonut';
import { HOUR_MS, type KindMs, type DonutSegment } from './statsModel';

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const emptyWeek = (): KindMs[] => Array.from({ length: 7 }, () => ({ task: 0, meeting: 0, habit: 0 }));

describe('StatCard', () => {
  it('renders label, value + unit and sub', () => {
    render(<StatCard label="Total scheduled" value="34" unit="h" sub="this week" />);
    const card = screen.getByTestId('stat-card');
    expect(card).toHaveTextContent('Total scheduled');
    expect(card).toHaveTextContent('34h');
    expect(card).toHaveTextContent('this week');
  });

  it('shows the meeting swatch only when asked', () => {
    const { rerender } = render(<StatCard label="In meetings" value="2" unit="h" sub="3 events" swatch="meeting" />);
    expect(screen.getByTestId('stat-card').querySelector('[data-series="meeting"]')).not.toBeNull();
    rerender(<StatCard label="Task time" value="2" unit="h" sub="auto-scheduled" />);
    expect(screen.getByTestId('stat-card').querySelector('[data-series]')).toBeNull();
  });

  it('renders a progress bar with its value', () => {
    render(<StatCard label="Tasks done" value="1" unit=" / 4" sub="25% complete" progressPct={25} />);
    const bar = screen.getByRole('progressbar', { name: 'Tasks done' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%');
  });

  it('shrinks the stat value below md so it stays on one line', () => {
    render(<StatCard label="Total scheduled" value="12.5" unit="h" sub="this week" />);
    const value = screen.getByTestId('stat-value');
    expect(value.className).toContain('text-[40px]');
    expect(value.className).toContain('md:text-[56px]');
  });
});

describe('HoursByDayChart', () => {
  it('renders 7 day labels and scales a busy day bar to px height on the axis top', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 3 * HOUR_MS, meeting: 0, habit: 0 }; // 3h on a 0..3h axis → full 240px plot (−2px gap)
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    expect(screen.getByTestId('hours-by-day')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
    const bars = screen.getAllByTestId('bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute('data-series', 'task');
    expect(bars[0]!.style.height).toBe('238px');
  });

  it('reserves headroom above the plot for the busiest bar\'s total label (it sits above the axis top)', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 3 * HOUR_MS, meeting: 0, habit: 0 };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    // The y-ticks and the plot share this box, so the padding shifts both and keeps them aligned.
    expect(screen.getByTestId('y-ticks').parentElement!.className).toContain('pt-6');
  });

  it('stacks meetings over habits over tasks; only the topmost segment is the rounded one', () => {
    const perDay = emptyWeek();
    perDay[2] = { task: HOUR_MS, meeting: HOUR_MS, habit: HOUR_MS };
    perDay[3] = { task: HOUR_MS, meeting: 0, habit: HOUR_MS };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    const wed = screen.getByRole('button', { name: /^Wednesday/ });
    expect(within(wed).getAllByTestId('bar').map((b) => b.getAttribute('data-series'))).toEqual(['meeting', 'habit', 'task']);
    expect(within(wed).getAllByTestId('bar').map((b) => b.getAttribute('data-top'))).toEqual(['true', 'false', 'false']);
    const thu = screen.getByRole('button', { name: /^Thursday/ });
    expect(within(thu).getAllByTestId('bar')[0]).toHaveAttribute('data-series', 'habit');
    expect(within(thu).getAllByTestId('bar')[0]).toHaveAttribute('data-top', 'true');
  });

  it('labels each bar with its total, draws y ticks from the max and names each day for screen readers', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 0, meeting: 3.9 * HOUR_MS, habit: 0 };
    perDay[3] = { task: 0, meeting: 3.8 * HOUR_MS, habit: 2 * HOUR_MS };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    expect(screen.getByTestId('y-ticks')).toHaveTextContent('0h2h4h6h');
    expect(screen.getByRole('button', { name: 'Thursday: meetings 3.8h, habits 2h, tasks 0h, total 5.8h' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Thursday/ })).getByTestId('bar-total')).toHaveTextContent('5.8h');
    // an empty day has no value label
    expect(within(screen.getByRole('button', { name: /^Tuesday/ })).queryByTestId('bar-total')).toBeNull();
  });

  it('shows a tooltip for the hovered or focused day only', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 0, meeting: HOUR_MS, habit: 0 };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    expect(screen.queryByTestId('bar-tooltip')).toBeNull();
    const mon = screen.getByRole('button', { name: /^Monday/ });
    fireEvent.mouseEnter(mon);
    expect(screen.getByTestId('bar-tooltip')).toHaveTextContent('Monday');
    fireEvent.mouseLeave(mon);
    expect(screen.queryByTestId('bar-tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: /^Friday/ }));
    expect(screen.getByTestId('bar-tooltip')).toHaveTextContent('Friday');
  });

  it('lets the bar columns shrink below their 40px desktop width', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 4 * HOUR_MS, meeting: 0, habit: 0 };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    const stack = screen.getAllByTestId('bar')[0]!.parentElement!;
    const column = stack.parentElement!;
    // the column may shrink past its min-content width
    expect(column.className).toContain('flex-1');
    expect(column.className).toContain('min-w-0');
    // the bar stack is fluid, capped at 40px
    expect(stack.className).toContain('w-[70%]');
    expect(stack.className).toContain('max-w-[40px]');
  });

  it('Table tab renders a row per day with the same numbers as the chart labels, plus totals', () => {
    const perDay = emptyWeek();
    perDay[0] = { task: 0, meeting: 3.9 * HOUR_MS, habit: 0 };
    perDay[1] = { task: HOUR_MS, meeting: 4.6 * HOUR_MS, habit: 0.5 * HOUR_MS };
    render(<HoursByDayChart perDay={perDay} shortLabels={SHORT} longLabels={LONG} />);
    const chartLabels = screen.getAllByTestId('bar-total').map((l) => l.textContent);
    expect(chartLabels).toEqual(['3.9h', '6.1h']);

    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryAllByTestId('bar')).toHaveLength(0);
    const table = screen.getByRole('table', { name: 'Hours by day' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 7 + 1); // header + 7 days + totals
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['3.9h', '0h', '0h', '3.9h']);
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Monday');
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['4.6h', '0.5h', '1h', '6.1h']);
    expect(within(rows[8]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['8.5h', '0.5h', '1h', '10h']);
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Day', 'Meetings', 'Habits', 'Tasks', 'Total']);
  });
});

describe('TimeSplitDonut', () => {
  const segments: DonutSegment[] = [
    { kind: 'meeting', ms: HOUR_MS, fromPct: 0, toPct: 25 },
    { kind: 'habit', ms: HOUR_MS, fromPct: 25, toPct: 50 },
    { kind: 'task', ms: 2 * HOUR_MS, fromPct: 50, toPct: 100 },
  ];

  it('renders the legend rows with hours + percent and the centre total', () => {
    render(<TimeSplitDonut segments={segments} totalMs={4 * HOUR_MS} />);
    const tasks = screen.getByTestId('split-row-task');
    expect(tasks).toHaveTextContent('Tasks');
    expect(tasks).toHaveTextContent('2h');
    expect(tasks).toHaveTextContent('50%');
    expect(screen.getByTestId('split-row-meeting')).toHaveTextContent('25%');
    expect(screen.getByTestId('donut-total')).toHaveTextContent('4h');
  });

  it('draws one arc per segment and describes the split as an image', () => {
    render(<TimeSplitDonut segments={segments} totalMs={4 * HOUR_MS} />);
    const img = screen.getByRole('img', { name: 'Meetings 1 hours, 25 percent; Habits 1 hours, 25 percent; Tasks 2 hours, 50 percent' });
    const arcs = img.querySelectorAll('[data-series]');
    expect([...arcs].map((a) => a.getAttribute('data-series'))).toEqual(['meeting', 'habit', 'task']);
    expect(arcs[0]!.getAttribute('stroke-dasharray')).toMatch(/^\d+(\.\d)? \d+(\.\d)?$/);
  });

  it('shows an empty message when there are no segments', () => {
    render(<TimeSplitDonut segments={[]} totalMs={0} />);
    expect(screen.getByText(/no scheduled time yet/i)).toBeInTheDocument();
  });
});
