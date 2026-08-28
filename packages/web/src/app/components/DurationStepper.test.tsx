import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationStepper, durationLabel } from './DurationStepper';

describe('DurationStepper', () => {
  it('steps by 15 minutes and floors at 15', () => {
    const onChange = vi.fn();
    render(<DurationStepper label="duration" valueMs={15 * 60_000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'decrease duration' }));
    expect(onChange).toHaveBeenLastCalledWith(15 * 60_000);
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' }));
    expect(onChange).toHaveBeenLastCalledWith(30 * 60_000);
    expect(durationLabel(90 * 60_000)).toBe('1 hr 30 min');
  });

  it('grows both step buttons on a coarse pointer without moving the icons', () => {
    // Sized for the SMALLER caller: every drawer/popover passes size={22}, so the padding must
    // clear the floor there (22 + 20 = 42px), not just at the default 26 (46px).
    render(<DurationStepper label="duration" size={22} valueMs={15 * 60_000} onChange={vi.fn()} />);
    for (const name of ['decrease duration', 'increase duration']) {
      expect(screen.getByRole('button', { name }).className).toContain('coarse:p-2.5');
    }
    expect(screen.getByRole('button', { name: 'decrease duration' }).parentElement!.className).toContain('coarse:gap-1');
  });
});
