import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('renders a labelled dialog anchored to the bottom edge', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const sheet = screen.getByRole('dialog', { name: 'Tasks' });
    expect(sheet.className).toContain('bottom-0');
    expect(sheet.className).toContain('h-[70dvh]');
    expect(sheet.className).toContain('pb-[env(safe-area-inset-bottom)]');
    // Modal tier: MobileTabBar is a z-40 bottom-anchored bar that renders later in AppShell's
    // DOM, so a z-40 backdrop would let taps in the bottom strip fall through to the tabs.
    expect(screen.getByTestId('sheet-backdrop').className).toContain('z-50');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('dismisses on a backdrop tap', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on a tap inside the sheet', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses from the close button', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Sheet collapsed for a drag', () => {
  it('slides down to a strip while keeping its children mounted', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()} collapsed><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet.className).toContain('translate-y-[calc(100%_-_56px)]');
    // Unmounting the children would drop the dragged card out of the DOM and abort the drag.
    expect(screen.getByText('body')).toBeInTheDocument();
    // The grid underneath is the drag target and is NOT hidden from AT while the sheet is a strip.
    expect(sheet).toHaveAttribute('aria-modal', 'false');
  });

  it('lets the grid underneath receive the drag and does not dismiss on a stray click', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose} collapsed><p>body</p></Sheet>);
    const backdrop = screen.getByTestId('sheet-backdrop');
    expect(backdrop.className).toContain('pointer-events-none');
    expect(backdrop.className).not.toContain('bg-black/30');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Sheet a11y', () => {
  it('is a modal dialog that takes focus on mount', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(sheet);
  });

  it('does not steal focus from an autoFocus field inside it', () => {
    // React applies autoFocus during the commit phase, before this component's passive effect —
    // so the create form's title input must keep the focus it just took.
    render(<Sheet label="New entry" onClose={vi.fn()}><input autoFocus data-testid="inner-field" /></Sheet>);
    expect(document.activeElement).toBe(screen.getByTestId('inner-field'));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    // Fired on the sheet itself, which holds focus after mount -- Escape is the dialog's own
    // keystroke, not the document's. See the stacking test below for why that matters.
    fireEvent.keyDown(screen.getByTestId('sheet'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape pressed in a modal stacked above it', () => {
    // AppShell renders NewTaskModal as a SIBLING of the sheet, so on compact a modal can sit over
    // an open Tasks sheet -- and a document-level listener would let Escape dismiss the invisible
    // sheet behind it. The focus trap means the topmost surface owns the keystroke.
    const onClose = vi.fn();
    render(
      <>
        <Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>
        <button data-testid="stacked-above">modal</button>
      </>,
    );
    const above = screen.getByTestId('stacked-above');
    above.focus();
    fireEvent.keyDown(above, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns focus to whatever opened it when it unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('returns focus to the opener even when a field inside autoFocused', () => {
    // The opener must be captured during render, before React's commit phase moves focus to the
    // autoFocused input -- capturing at effect time would record the input, which is detached by
    // the time the cleanup runs, dropping focus to <body> instead of back to the opener.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Sheet label="New entry" onClose={vi.fn()} scrollBody><input autoFocus data-testid="inner-field" /></Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByTestId('inner-field'));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the sheet in both directions', () => {
    render(
      <Sheet label="Tasks" onClose={vi.fn()}>
        <button>first</button>
        <button>last</button>
      </Sheet>,
    );
    const close = screen.getByTestId('sheet-close'); // first focusable in DOM order
    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('gives the close control a 44px touch target', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const close = screen.getByTestId('sheet-close');
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');
  });
});

describe('Sheet variants', () => {
  it('fullScreen fills the viewport with square top corners', () => {
    render(<Sheet label="Edit task" onClose={vi.fn()} fullScreen><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet.className).toContain('h-dvh');
    expect(sheet.className).not.toContain('h-[70dvh]');
    expect(sheet.className).not.toContain('rounded-t-[18px]');
  });

  it('scrolls its body only when asked to', () => {
    const { unmount } = render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const plain = screen.getByText('body').parentElement!;
    expect(plain.className).toContain('overflow-hidden');
    expect(plain.className).toContain('overscroll-contain');
    unmount();
    render(<Sheet label="New entry" onClose={vi.fn()} scrollBody><p>body</p></Sheet>);
    const scrolling = screen.getByText('body').parentElement!;
    expect(scrolling.className).toContain('overflow-y-auto');
    expect(scrolling.className).toContain('overscroll-contain');
  });

  it('carries no transform unless it is collapsed', () => {
    // A standing transform makes the sheet the containing block for every `fixed` descendant —
    // and from this phase on, sheets contain drawers. Regression guard for 92e0c8a M1.
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    expect(screen.getByTestId('sheet').className).not.toContain('translate-y');
  });
});
