import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PriorityPicker } from './PriorityPicker';

describe('PriorityPicker', () => {
  it('renders one chip per bucket', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    for (const name of [/critical/i, /high/i, /medium/i, /low/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the chip matching the value as pressed and the others as not', () => {
    render(<PriorityPicker value={2} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /critical/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /low/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('treats any priority above 4 as Low (bucket mapping)', () => {
    render(<PriorityPicker value={9} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /low/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the numeric priority of the clicked chip', () => {
    const onChange = vi.fn();
    render(<PriorityPicker value={4} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /critical/i }));
    fireEvent.click(screen.getByRole('button', { name: /high/i }));
    fireEvent.click(screen.getByRole('button', { name: /medium/i }));
    fireEvent.click(screen.getByRole('button', { name: /low/i }));
    expect(onChange.mock.calls.map(([p]) => p)).toEqual([1, 2, 3, 4]);
  });

  it('uses plain buttons so it cannot submit a surrounding form', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /critical/i })).toHaveAttribute('type', 'button');
  });

  it('gives the chips a touch-sized row on a coarse pointer', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /low/i });
    expect(chip.className).toContain('coarse:px-3');
    expect(chip.className).toContain('coarse:py-3.5');
  });
});
