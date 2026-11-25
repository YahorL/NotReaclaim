import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavLinkItem } from './NavItem';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavLinkItem to="/" end label="Planner" icon={<svg aria-hidden="true" />} />
      <NavLinkItem to="/priorities" label="Priorities" icon={<svg aria-hidden="true" />} />
    </MemoryRouter>,
  );
}

describe('NavLinkItem', () => {
  it('is an icon-only link named by its label, with a tooltip label', () => {
    renderAt('/priorities');
    const link = screen.getByRole('link', { name: 'Priorities' });
    expect(link).toHaveAttribute('href', '/priorities');
    expect(link).toHaveAttribute('data-label', 'Priorities');
    expect(link.textContent).toBe('');
  });

  it('marks only the current route active (aria-current + data-active)', () => {
    renderAt('/priorities');
    const active = screen.getByRole('link', { name: 'Priorities' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active', 'true');
    // `end` keeps "/" from matching every route.
    const planner = screen.getByRole('link', { name: 'Planner' });
    expect(planner).not.toHaveAttribute('aria-current');
    expect(planner).not.toHaveAttribute('data-active');
  });
});
