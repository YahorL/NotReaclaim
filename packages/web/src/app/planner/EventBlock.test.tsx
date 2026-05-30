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

  it('marks pinned blocks', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-pinned', 'true');
  });
});
