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

  it('marks pinned blocks with an amber left bar', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'true');
    expect(el.className).toContain('border-l-[#f59e0b]');
  });

  it('renders a proposed block as a dashed ghost', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={10} heightPct={5} startLabel="13:00" proposed />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'true');
    expect(el).toHaveAttribute('data-kind', 'task');
    expect(el.className).toContain('border-dashed');
  });

  it('a committed task block is solid: kind tint + kind bar, dark text, no dashed border', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'false');
    expect(el.className).not.toContain('border-dashed');
    expect(el.className).toContain('text-kind-taskText');
    expect(el.className).toContain('bg-kind-taskBg');
    expect(el.className).toContain('border-l-kind-taskBar');
    expect(el.className).not.toContain('text-white');
  });
});
