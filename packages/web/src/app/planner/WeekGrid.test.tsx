import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { startOfWeek, dayColumns } from './weekModel';
import { WeekGrid, type WeekGridProps } from './WeekGrid';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

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
      onCommit={vi.fn()}
      {...props}
    />,
  );
}

function renderGridWithProviders(props: Partial<WeekGridProps> = {}) {
  return renderWithProviders(
    <WeekGrid
      days={days} nowMs={WED_NOON} weekLabel="Jan 5 – 11"
      blocks={[block()]} events={[event()]} replanPending={false}
      onPrev={vi.fn()} onToday={vi.fn()} onNext={vi.fn()} onReplan={vi.fn()} onCommit={vi.fn()}
      {...props}
    />,
    { api: fakeApiClient() },
  );
}

describe('WeekGrid click-to-create', () => {
  it('clicking empty column space opens the popover at the snapped slot', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    // jsdom: rect height 0 → fraction 0 → slot starts at the 00:00 window top
    // The slot label renders in locale 12-hour format (e.g. "12:00 AM") or 24-hour format ("00:00")
    expect(screen.getByTestId('slot-label').textContent).toMatch(/12:00 AM|00:00/);
  });

  it('clicking an existing block does not open the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getAllByTestId('event-block')[0]!);
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });

  it('Escape closes the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });
});

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
    fireEvent.click(screen.getByRole('button', { name: /^previous$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('threads accent to a task block when accents map is provided', () => {
    // block() has taskId:'t1', provide accent for t1
    renderGrid({ accents: { t1: '#5b62e3' } });
    // The task block should receive the accent → borderColor inline style
    const taskBlock = screen.getAllByTestId('event-block').find(
      (b) => b.getAttribute('data-kind') === 'task',
    )!;
    expect(taskBlock.style.borderColor).toBe('rgb(91, 98, 227)');
  });

  it('no accents → task block has no inline borderColor', () => {
    renderGrid();
    const taskBlock = screen.getAllByTestId('event-block').find(
      (b) => b.getAttribute('data-kind') === 'task',
    )!;
    expect(taskBlock.style.borderColor).toBe('');
  });

  it('delete on a task block calls onDeleteBlock with the block id', () => {
    const onDeleteBlock = vi.fn();
    renderGrid({ onDeleteBlock });
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    fireEvent.click(btn);
    expect(onDeleteBlock).toHaveBeenCalledWith('b1');
  });

  it('delete on a calendar event calls onDeleteEvent with the event id', () => {
    const onDeleteEvent = vi.fn();
    renderGrid({ onDeleteEvent });
    const btn = screen.getByRole('button', { name: /delete event/i, hidden: true });
    fireEvent.click(btn);
    expect(onDeleteEvent).toHaveBeenCalledWith('e1');
  });

  it('dropping a task card on a day column calls onScheduleTaskAt with the day + slot', () => {
    const onScheduleTaskAt = vi.fn();
    renderGrid({ onScheduleTaskAt });
    const col = screen.getByTestId('day-col-0');
    const dt = {
      types: ['application/x-nr-task'],
      getData: (t: string) => (t === 'application/x-nr-task' ? 'task-1' : ''),
      dropEffect: '',
    };
    fireEvent.dragOver(col, { clientY: 100, dataTransfer: dt });
    // indicator appears for the hovered column
    expect(screen.getByTestId('task-drop-indicator')).toBeInTheDocument();
    fireEvent.drop(col, { clientY: 100, dataTransfer: dt });
    expect(onScheduleTaskAt).toHaveBeenCalledTimes(1);
    const [taskId, dayStartMs, startMin] = onScheduleTaskAt.mock.calls[0]!;
    expect(taskId).toBe('task-1');
    expect(dayStartMs).toBe(days[0]);
    expect(typeof startMin).toBe('number');
  });

  it('ignores dragover that is not a task card (no indicator)', () => {
    const onScheduleTaskAt = vi.fn();
    renderGrid({ onScheduleTaskAt });
    const col = screen.getByTestId('day-col-0');
    fireEvent.dragOver(col, { clientY: 100, dataTransfer: { types: ['text/plain'], getData: () => '', dropEffect: '' } });
    expect(screen.queryByTestId('task-drop-indicator')).toBeNull();
  });

  it('puts the hour grid in a scroll container, below the day header', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    expect(scroller.className).toMatch(/overflow-y-auto/);
    // day headers are OUTSIDE the scroll container (they stay pinned)
    expect(scroller.querySelector('[data-testid="day-header-0"]')).toBeNull();
    expect(screen.getByTestId('day-header-0')).toBeInTheDocument();
    // hour rows / day columns ARE inside the scroller
    expect(scroller.querySelector('[data-testid="day-col-0"]')).not.toBeNull();
  });

  it('renders one column per day for a 3-day window and has no horizontal-scroll wrapper', () => {
    const days = [
      new Date('2026-01-07T00:00:00.000Z').getTime(),
      new Date('2026-01-08T00:00:00.000Z').getTime(),
      new Date('2026-01-09T00:00:00.000Z').getTime(),
    ];
    renderGrid({ days }); // 3-day window starting Wed 2026-01-07
    expect(screen.getByTestId('day-col-0')).toBeInTheDocument();
    expect(screen.getByTestId('day-col-2')).toBeInTheDocument();
    expect(screen.queryByTestId('day-col-3')).toBeNull();
    // day labels follow the actual dates (today-anchored), not fixed Mon-first
    expect(screen.getByTestId('day-header-0').textContent).toMatch(/Wed/);
  });

});
