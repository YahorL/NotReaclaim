import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar', () => {
  it('renders the five primary destinations as links', () => {
    renderWithProviders(<MobileTabBar />);
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('is fixed to the bottom, hidden at md and above, and reserves the safe-area inset', () => {
    renderWithProviders(<MobileTabBar />);
    const bar = screen.getByTestId('mobile-tab-bar');
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).toContain('md:hidden');
    expect(bar.className).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('marks only the tab for the current route as active', () => {
    renderWithProviders(<MobileTabBar />, { initialEntries: ['/priorities'] });
    expect(screen.getByRole('link', { name: 'Priorities' }).className).toContain('text-indigo');
    // `end` on the Planner tab keeps "/" from matching every route.
    expect(screen.getByRole('link', { name: 'Planner' }).className).not.toContain('text-indigo');
  });
});
