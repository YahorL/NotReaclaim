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

  it('shows the value as tabular text', () => {
    render(<DurationStepper label="duration" valueMs={75 * 60_000} onChange={vi.fn()} />);
    expect(screen.getByTestId('duration-value')).toHaveTextContent('1 hr 15 min');
    expect(screen.getByTestId('duration-value').className).toContain('tabular-nums');
  });

  it('disables both buttons when disabled', () => {
    render(<DurationStepper label="duration" disabled valueMs={30 * 60_000} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'decrease duration' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'increase duration' })).toBeDisabled();
  });

  it('marks the compact variant for the drawers and popover (size below the default)', () => {
    const { rerender } = render(<DurationStepper label="duration" valueMs={15 * 60_000} onChange={vi.fn()} />);
    expect(screen.getByTestId('duration-stepper')).not.toHaveAttribute('data-compact');
    rerender(<DurationStepper label="duration" size={22} valueMs={15 * 60_000} onChange={vi.fn()} />);
    expect(screen.getByTestId('duration-stepper')).toHaveAttribute('data-compact', 'true');
  });

  it('wraps the buttons under the value instead of letting them overlap it', () => {
    // Found live at 1024px on a touch pointer: in TaskDrawer's half column "1 hr 30 min" ran under
    // two 44px buttons. The value never shrinks below its text; the button pair wraps as a unit.
    render(<DurationStepper label="duration" size={22} valueMs={90 * 60_000} onChange={vi.fn()} />);
    const stepper = screen.getByTestId('duration-stepper');
    expect(stepper.className).toContain('flex-wrap');
    expect(screen.getByTestId('duration-value').className).toContain('flex-[1_0_auto]');
    const pair = screen.getByRole('button', { name: 'decrease duration' }).parentElement!;
    expect(pair).toBe(screen.getByRole('button', { name: 'increase duration' }).parentElement);
    expect(pair.className).toContain('ml-auto');
  });

  it('grows both step buttons to a 44px target on a coarse pointer, at either size', () => {
    for (const size of [undefined, 22]) {
      const { unmount } = render(<DurationStepper label="duration" size={size} valueMs={15 * 60_000} onChange={vi.fn()} />);
      for (const name of ['decrease duration', 'increase duration']) {
        const cls = screen.getByRole('button', { name }).className;
        expect(cls).toContain('coarse:h-11');
        expect(cls).toContain('coarse:w-11');
      }
      unmount();
    }
  });
});
