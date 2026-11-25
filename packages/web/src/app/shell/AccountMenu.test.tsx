import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import { AccountMenu } from './AccountMenu';

function openMenu() {
  renderWithProviders(<AccountMenu />);
  const button = screen.getByRole('button', { name: 'Account menu' });
  fireEvent.click(button);
  return button;
}

describe('AccountMenu', () => {
  it('is a menu button that starts closed', () => {
    renderWithProviders(<AccountMenu />);
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with Settings and Sign out, focusing the first item', () => {
    const button = openMenu();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Settings', 'Sign out']);
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(document.activeElement).toBe(items[0]);
  });

  it('moves between items with the arrow keys (wrapping)', () => {
    openMenu();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Settings' }));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }));
  });

  it('closes on Escape and returns focus to the button', () => {
    const button = openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside pointerdown', () => {
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens from the keyboard with ArrowDown', () => {
    renderWithProviders(<AccountMenu />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Account menu' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
