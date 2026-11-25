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
