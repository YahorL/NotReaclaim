import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavLinkItem, NavDisabledItem, NavSection } from './NavItem';

describe('NavItem', () => {
  it('NavLinkItem renders a link and is active on its route', () => {
    render(
      <MemoryRouter initialEntries={['/priorities']}>
        <NavLinkItem to="/priorities" label="Priorities" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Priorities' });
    expect(link).toHaveAttribute('href', '/priorities');
    expect(link.className).toContain('bg-sidebarHover');
  });

  it('NavDisabledItem shows a Soon pill and is not a link', () => {
    render(<NavDisabledItem label="Buffers" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Buffers')).toBeInTheDocument();
    expect(screen.getByText(/soon/i)).toBeInTheDocument();
  });

  it('NavSection toggles via onToggle and reflects open state', () => {
    const onToggle = vi.fn();
    render(<NavSection label="Time blocking" open onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /time blocking/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
