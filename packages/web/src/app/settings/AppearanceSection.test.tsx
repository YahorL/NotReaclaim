import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import { resetThemeStoreForTests } from '../../theme/useTheme';
import { DARK_QUERY, THEME_KEY } from '../../theme/theme';
import { AppearanceSection } from './AppearanceSection';

const root = document.documentElement;
let mm: FakeMatchMedia | null = null;

beforeEach(() => {
  localStorage.clear();
  resetThemeStoreForTests();
  root.removeAttribute('data-theme');
});
afterEach(() => { mm?.restore(); mm = null; localStorage.clear(); resetThemeStoreForTests(); });

describe('AppearanceSection', () => {
  it('is a System / Light / Dark radio group with System checked when nothing is stored', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    render(<AppearanceSection />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
  });

  it('Light sets data-theme and persists nr.theme', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    render(<AppearanceSection />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });

  it('System clears the stored choice and follows the OS again', () => {
    mm = installMatchMedia({ [DARK_QUERY]: true });
    localStorage.setItem(THEME_KEY, 'light');
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('arrow keys move the choice', () => {
    mm = installMatchMedia({ [DARK_QUERY]: false });
    render(<AppearanceSection />);
    const system = screen.getByRole('radio', { name: 'System' });
    system.focus();
    fireEvent.keyDown(system, { key: 'ArrowRight' });
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
  });
});
