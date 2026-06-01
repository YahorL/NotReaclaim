import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBlock } from './EventBlock';

describe('EventBlock', () => {
  it('renders title, kind, and position', () => {
    render(<EventBlock title="Standup" kind="meeting" topPct={10} heightPct={5} startLabel="10:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveTextContent('Standup');
    expect(el).toHaveAttribute('data-kind', 'meeting');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.style.top).toBe('10%');
    expect(el.style.height).toBe('5%');
  });

  it('renders a meeting as a solid blue block', () => {
    render(<EventBlock title="Standup" kind="meeting" topPct={0} heightPct={5} startLabel="10:00" />);
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('bg-event');
    expect(el.className).toContain('text-white');
    expect(el).not.toHaveTextContent('🔒');
  });

  it('renders a locked (pinned) task as solid green with a lock', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'true');
    expect(el.className).toContain('bg-low');
    expect(el.className).toContain('text-white');
    expect(el).toHaveTextContent('🔒');
    expect(el.className).not.toContain('border-dashed');
  });

  it('renders a movable (unpinned) task as transparent with a dashed green outline', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.className).toContain('border-dashed');
    expect(el.className).toContain('border-low');
    expect(el.className).not.toContain('text-white');
    expect(el).not.toHaveTextContent('🔒');
  });

  it('renders a locked (pinned) habit as solid green with a lock', () => {
    render(<EventBlock title="Morning run" kind="habit" pinned topPct={0} heightPct={5} startLabel="07:00" />);
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('bg-low');
    expect(el.className).toContain('text-white');
    expect(el).toHaveTextContent('🔒');
  });

  it('a movable habit uses the same scheme as a task', () => {
    render(<EventBlock title="Workout" kind="habit" topPct={0} heightPct={5} startLabel="08:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'habit');
    expect(el.className).toContain('border-dashed');
    expect(el.className).toContain('border-low');
  });
});
