import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useClickOutside } from './useClickOutside';

function Probe({ onOutside, enabled }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside, enabled);
  return (
    <div>
      <div ref={ref} data-testid="inside">inside</div>
      <button data-testid="outside">outside</button>
    </div>
  );
}

describe('useClickOutside', () => {
  it('fires when the press lands outside the ref', () => {
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} />);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onOutside).not.toHaveBeenCalled();   // touch never delivers a timely mousedown
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the press lands inside the ref', () => {
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId('inside'));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('subscribes to nothing when disabled', () => {
    // Inside a Sheet the sheet owns dismissal: a second outside-dismiss here would close on the
    // press and hand the following click to whatever sits under the backdrop.
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} enabled={false} />);
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
