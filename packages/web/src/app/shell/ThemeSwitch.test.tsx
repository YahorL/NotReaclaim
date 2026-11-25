import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import { resetThemeStoreForTests } from '../../theme/useTheme';
import { DARK_QUERY, THEME_KEY } from '../../theme/theme';
import { ThemeSwitch } from './ThemeSwitch';

const root = document.documentElement;
let mm: FakeMatchMedia | null = null;

beforeEach(() => {
  localStorage.clear();
  resetThemeStoreForTests();
  root.removeAttribute('data-theme');
});
afterEach(() => { mm?.restore(); mm = null; localStorage.clear(); });

describe('ThemeSwitch', () => {
  it('is a labelled group of two toggle buttons', () => {
    render(<ThemeSwitch />);
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Light mode' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'Dark mode' }));
  });

  it('presses the button of the resolved theme while the pref is system', () => {
    mm = installMatchMedia({ [DARK_QUERY]: false });
    render(<ThemeSwitch />);
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('clicking Light sets data-theme on <html> and persists the choice', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    render(<ThemeSwitch />);
    expect(root.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Dark switches back and persists dark', () => {
    localStorage.setItem(THEME_KEY, 'light');
    render(<ThemeSwitch />);
    expect(root.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('an explicit choice ignores later OS changes', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    mm.set(DARK_QUERY, false);
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('carries a tooltip label for each button', () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('data-label', 'Light mode');
  });
});
