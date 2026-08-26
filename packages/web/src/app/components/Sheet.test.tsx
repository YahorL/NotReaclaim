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
