import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CalendarEvent, Task } from '../../api/types';
import { BlockDetailCard, type BlockDetail, type BlockDetailCardProps } from './BlockDetailCard';

const START = Date.parse('2026-11-25T21:30:00.000Z'); // Wed 4:30 PM in New York
const END = START + 75 * 60_000;

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup', startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString(),
  googleCalendarId: 'primary', googleEventId: 'g1', source: 'google', ...over,
});

const base: BlockDetail = {
  key: 'b:b1', kind: 'task', source: null, title: 'Write spec', startMs: START, endMs: END,
  pinned: false, started: false, running: false, taskId: 't1', event: null,
};

function renderCard(detail: Partial<BlockDetail>, over: Partial<BlockDetailCardProps> = {}) {
  const props: BlockDetailCardProps = {
    detail: { ...base, ...detail }, zone: 'America/New_York',
    onClose: vi.fn(), onOpenTask: vi.fn(), onOpenEvent: vi.fn(), onOpenHabits: vi.fn(),
    onUnpin: vi.fn(), onStop: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(<BlockDetailCard {...props} />);
  return props;
}

describe('BlockDetailCard', () => {
  it('shows title, long day, time and duration in the settings zone', () => {
    renderCard({});
    expect(screen.getByRole('heading', { name: 'Write spec' })).toBeInTheDocument();
    expect(screen.getByText('Wednesday, Nov 25')).toBeInTheDocument();
    expect(screen.getByTestId('detail-time')).toHaveTextContent('4:30 PM – 5:45 PM');
    expect(screen.getByTestId('detail-duration')).toHaveTextContent('1h 15m');
  });

  it('auto task: "Task · Auto-scheduled", Open task + Delete', () => {
    const p = renderCard({});
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Task · Auto-scheduled');
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
    expect(p.onOpenTask).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByTestId('detail-delete'));
    expect(p.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('detail-unpin')).toBeNull();
  });

  it('pinned task: "Task · Pinned" and Unpin instead of Delete', () => {
    const p = renderCard({ pinned: true });
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Task · Pinned');
    fireEvent.click(screen.getByTestId('detail-unpin'));
    expect(p.onUnpin).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('detail-delete')).toBeNull();
  });

  it('running task: "Task · In progress" and Stop', () => {
    const p = renderCard({ pinned: true, started: true, running: true });
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Task · In progress');
    fireEvent.click(screen.getByTestId('detail-stop'));
    expect(p.onStop).toHaveBeenCalledTimes(1);
  });

  it('habit: Open habits navigates to the Habits page', () => {
    const p = renderCard({ kind: 'habit', taskId: null, title: 'Morning' });
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Habit · Movable');
    fireEvent.click(screen.getByRole('button', { name: 'Open habits' }));
    expect(p.onOpenHabits).toHaveBeenCalledTimes(1);
  });

  it('app event: "Event · Movable", Open event + Delete', () => {
    const e = ev({ source: 'app', googleCalendarId: null, googleEventId: null });
    const p = renderCard({ key: 'e:e1', kind: 'meeting', source: 'app', taskId: null, event: e, title: 'Coffee' });
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Event · Movable');
    fireEvent.click(screen.getByRole('button', { name: 'Open event' }));
    expect(p.onOpenEvent).toHaveBeenCalledWith(e);
    expect(screen.getByTestId('detail-delete')).toBeInTheDocument();
  });

  it('blocked time: "Blocked time", Open event + Delete', () => {
    const e = ev({ source: 'app', kind: 'blocked', title: 'Gym' });
    renderCard({ key: 'e:e1', kind: 'blocked', source: 'app', taskId: null, event: e, title: 'Gym' });
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Blocked time');
    expect(screen.getByRole('button', { name: 'Open event' })).toBeInTheDocument();
    expect(screen.getByTestId('detail-delete')).toBeInTheDocument();
  });

  it('Google meeting: locked — no Open, no Unpin, no Delete', () => {
    renderCard({ key: 'e:e1', kind: 'meeting', source: 'google', taskId: null, event: ev(), title: 'Standup' });
    expect(screen.getByTestId('block-detail-card')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByTestId('detail-chip')).toHaveTextContent('Meeting · Locked');
    expect(screen.queryByTestId('detail-open')).toBeNull();
    expect(screen.queryByTestId('detail-unpin')).toBeNull();
    expect(screen.queryByTestId('detail-delete')).toBeNull();
    expect(screen.getByTestId('block-detail-card')).toHaveTextContent('Synced from Google Calendar');
  });

  it('shows the task extras: priority, due and spent / left', () => {
    const task = { id: 't1', priority: 1, dueBy: '2026-11-30T17:00:00.000Z', durationMs: 7_200_000, spentMs: 1_800_000 } as Task;
    renderCard({}, { task });
    const extras = screen.getByTestId('detail-task-extras');
    expect(extras).toHaveTextContent('Critical');
    expect(extras).toHaveTextContent('Due Nov 30');
    expect(extras).toHaveTextContent('30m spent · 1h 30m left');
  });

  it('✕ calls onClose', () => {
    const p = renderCard({});
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('takes focus on its heading when opened from the keyboard', () => {
    renderCard({}, { autoFocus: true });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Write spec' }));
  });

  it('leaves focus alone when opened by a click', () => {
    renderCard({});
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Write spec' }));
  });
});
