import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import { REDUCED_MOTION_QUERY } from '../../theme/usePrefersReducedMotion';
import { ToastProvider, useToast, TOAST_MS } from './ToastProvider';

let mm: FakeMatchMedia | null = null;
afterEach(() => { vi.useRealTimers(); mm?.restore(); mm = null; });

function Trigger({ text, icon }: { text: string; icon?: 'lock' | 'check' }) {
  const { show } = useToast();
  return <button type="button" onClick={() => show(text, icon ? { icon } : undefined)}>{text}</button>;
}

function renderToasts() {
  return render(
    <ToastProvider>
      <Trigger text="Task created" icon="check" />
      <Trigger text="Locked" icon="lock" />
    </ToastProvider>,
  );
}

describe('ToastProvider', () => {
  it('always mounts an empty polite live region', () => {
    renderToasts();
    const region = screen.getByTestId('toast-region');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows a toast with its icon and clears it after 2.4s', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Task created' }));
    const toast = screen.getByTestId('toast');
    expect(toast).toHaveTextContent('Task created');
    expect(toast).toHaveAttribute('data-icon', 'check');
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1); });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(TOAST_MS).toBe(2400);
  });

  it('a toast can ask to stay longer (warnings, W6a); its animation is stretched to match, others keep 2.4s', () => {
    vi.useFakeTimers();
    function Long() {
      const { show } = useToast();
      return <button type="button" onClick={() => show('Something went wrong with a long explanation', { icon: 'warning', durationMs: 6000 })}>long</button>;
    }
    render(<ToastProvider><Long /><Trigger text="Locked" icon="lock" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'long' }));
    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('data-duration', '6000');
    expect(toast.className).toContain('animate-toast-long');
    expect(toast.style.animationDuration).toBe('6000ms');
    act(() => { vi.advanceTimersByTime(5999); });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('toast')).toBeNull();
    // The newest still replaces it, with its own (default) clock.
    fireEvent.click(screen.getByRole('button', { name: 'long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-duration', String(TOAST_MS));
    expect(screen.getByTestId('toast').className).toContain('animate-toast');
    expect(screen.getByTestId('toast').className).not.toContain('animate-toast-long');
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('shows one toast at a time: the newest replaces it and restarts the clock', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Task created' }));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast')).toHaveTextContent('Locked');
    act(() => { vi.advanceTimersByTime(2000); }); // the first toast's timer must not clear this one
    expect(screen.getByTestId('toast')).toHaveTextContent('Locked');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('animates normally but skips the animation under reduced motion (text still shows)', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-animated', 'true');
  });

  it('keeps the text but drops the animation when reduced motion is on', () => {
    mm = installMatchMedia({ [REDUCED_MOTION_QUERY]: true });
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    expect(screen.getByTestId('toast')).toHaveTextContent('Locked');
    expect(screen.getByTestId('toast')).toHaveAttribute('data-animated', 'false');
  });

  it('is a safe no-op outside a provider (pages rendered without the shell)', () => {
    render(<Trigger text="Hello" />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Hello' }))).not.toThrow();
  });

  it('can anchor the visible toast in a caller-provided container, keeping the live region', () => {
    function Anchored() {
      const { show, setAnchor } = useToast();
      return (
        <>
          <div data-testid="anchor" ref={setAnchor} />
          <button type="button" onClick={() => show('Locked')}>go</button>
        </>
      );
    }
    render(<ToastProvider><Anchored /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByTestId('anchor')).toContainElement(screen.getByTestId('toast'));
    expect(screen.getByTestId('toast-region')).toHaveTextContent('Locked');
  });
});
