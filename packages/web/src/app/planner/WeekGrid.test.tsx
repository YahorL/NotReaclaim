import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent, PreviewBlock } from '../../api/types';
import { startOfWeek, dayColumns } from './weekModel';
import { WeekGrid, type WeekGridProps } from './WeekGrid';

const MON = startOfWeek(Date.parse('2026-01-05T12:00:00.000Z')); // 2026-01-05
const days = dayColumns(MON);
const WED_NOON = Date.parse('2026-01-07T12:00:00.000Z');

const block = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-05T13:00:00.000Z', endsAt: '2026-01-05T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0', ...over,
});
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1', ...over,
});

function renderGrid(props: Partial<WeekGridProps> = {}) {
  return render(
    <WeekGrid
      days={days}
      nowMs={WED_NOON}
      weekLabel="Jan 5 – 11"
      blocks={[block()]}
      events={[event()]}
      replanPending={false}
      onPrev={vi.fn()}
      onToday={vi.fn()}
      onNext={vi.fn()}
      onReplan={vi.fn()}
      {...props}
    />,
  );
}

describe('WeekGrid', () => {
  it('places a meeting and a task block in their day columns', () => {
    renderGrid();
    const blocks = screen.getAllByTestId('event-block');
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'meeting' && b.textContent?.includes('Standup'))).toBe(true);
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'task' && b.textContent?.includes('Write spec'))).toBe(true);
  });

  it('highlights today', () => {
    renderGrid();
    const todayHeader = screen.getByTestId('day-header-2'); // index 2 = Wednesday
    expect(todayHeader).toHaveAttribute('data-today', 'true');
  });

  it('renders a now-line on today', () => {
    renderGrid();
    expect(screen.getByTestId('now-line')).toBeInTheDocument();
  });

  it('fires onReplan when the button is clicked', () => {
    const onReplan = vi.fn();
    renderGrid({ onReplan });
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    expect(onReplan).toHaveBeenCalledTimes(1);
  });

  it('fires nav callbacks', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
    renderGrid({ onPrev, onNext, onToday });
    fireEvent.click(screen.getByRole('button', { name: '◀' }));
    fireEvent.click(screen.getByRole('button', { name: '▶' }));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('renders proposed blocks as ghosts by default and the toggle hides them', () => {
    const proposed: PreviewBlock[] = [
      { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'Proposed focus',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
    ];
    renderGrid({ proposed });
    const ghosts = () => screen.getAllByTestId('event-block').filter((b) => b.getAttribute('data-proposed') === 'true');
    expect(ghosts().some((b) => b.textContent?.includes('Proposed focus'))).toBe(true);

    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.queryByText('Proposed focus')).toBeNull();
    expect(screen.getAllByTestId('event-block').some((b) => b.getAttribute('data-proposed') === 'false')).toBe(true);

    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.getByText('Proposed focus')).toBeInTheDocument();
  });
});
