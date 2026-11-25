import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PriorityPicker } from './PriorityPicker';

function Controlled({ initial = 4, onChange = vi.fn() }: { initial?: number; onChange?: (p: number) => void }) {
  const [value, setValue] = useState(initial);
  return <PriorityPicker value={value} onChange={(p) => { setValue(p); onChange(p); }} />;
}

describe('PriorityPicker', () => {
  it('is a radiogroup named Priority with one radio per bucket', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Priority' });
    expect(group).toBeInTheDocument();
    for (const name of [/critical/i, /high/i, /medium/i, /low/i]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('marks the radio matching the value as checked and the others as not', () => {
    render(<PriorityPicker value={2} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /high/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /critical/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /low/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('treats any priority above 4 as Low (bucket mapping)', () => {
    render(<PriorityPicker value={9} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /low/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('reports the numeric priority of the clicked radio', () => {
    const onChange = vi.fn();
    render(<PriorityPicker value={4} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /critical/i }));
    fireEvent.click(screen.getByRole('radio', { name: /high/i }));
    fireEvent.click(screen.getByRole('radio', { name: /medium/i }));
    fireEvent.click(screen.getByRole('radio', { name: /low/i }));
    expect(onChange.mock.calls.map(([p]) => p)).toEqual([1, 2, 3, 4]);
  });

  it('uses plain buttons so it cannot submit a surrounding form', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /critical/i })).toHaveAttribute('type', 'button');
  });

  it('has one tab stop: the checked radio (roving tabindex)', () => {
    render(<PriorityPicker value={3} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('tabindex', '0');
    for (const name of [/critical/i, /high/i, /low/i]) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('tabindex', '-1');
    }
  });

  it('arrow keys select and focus the next / previous radio, wrapping at the ends', () => {
    const onChange = vi.fn();
    render(<Controlled initial={4} onChange={onChange} />);
    const low = screen.getByRole('radio', { name: /low/i });
    low.focus();
    fireEvent.keyDown(low, { key: 'ArrowRight' }); // Low → wraps to Critical
    const critical = screen.getByRole('radio', { name: /critical/i });
    expect(critical).toHaveAttribute('aria-checked', 'true');
    expect(critical).toHaveFocus();
    expect(critical).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(critical, { key: 'ArrowDown' }); // Critical → High
    expect(screen.getByRole('radio', { name: /high/i })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: /high/i }), { key: 'ArrowLeft' }); // High → Critical
    fireEvent.keyDown(screen.getByRole('radio', { name: /critical/i }), { key: 'ArrowUp' }); // Critical → wraps to Low
    expect(screen.getByRole('radio', { name: /low/i })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: /low/i }), { key: 'Home' });
    expect(screen.getByRole('radio', { name: /critical/i })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: /critical/i }), { key: 'End' });
    expect(screen.getByRole('radio', { name: /low/i })).toHaveFocus();
    expect(onChange.mock.calls.map(([p]) => p)).toEqual([1, 2, 1, 4, 1, 4]);
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<PriorityPicker value={4} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /low/i }), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives the radios a touch-sized row on a coarse pointer', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /low/i }).className).toContain('coarse:h-11');
  });
});
