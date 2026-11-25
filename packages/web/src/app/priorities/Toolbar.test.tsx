import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import type { BoardColumnKey } from './priorityBucket';
import { Toolbar } from './Toolbar';

const ALL_COLUMNS: Record<BoardColumnKey, boolean> = {
  critical: true, high: true, medium: true, low: true, backlog: true, completed: true,
};

function renderToolbar(over: Partial<{ hideCompleted: boolean; setHideCompleted: (b: boolean) => void; colsVisible: Record<BoardColumnKey, boolean>; setColsVisible: (r: Record<BoardColumnKey, boolean>) => void; setQuery: (s: string) => void }> = {}) {
  renderWithProviders(
    <Toolbar
      query="" setQuery={over.setQuery ?? vi.fn()}
      hideCompleted={over.hideCompleted ?? false} setHideCompleted={over.setHideCompleted ?? vi.fn()}
      colsVisible={over.colsVisible ?? ALL_COLUMNS} setColsVisible={over.setColsVisible ?? vi.fn()}
    />,
  );
}

describe('Priorities Toolbar', () => {
  it('gives the search box its own full-width row below md, 460px at md+', () => {
    renderToolbar();
    const input = screen.getByLabelText('Search tasks');
    const box = input.parentElement!;
    const row = box.parentElement!;
    // Exact tokens: `toContain('w-[460px]')` would false-match `md:w-[460px]`.
    expect(box.classList.contains('w-full')).toBe(true);        // full width on a phone…
    expect(box.classList.contains('md:w-[460px]')).toBe(true);  // …desktop width per the design
    expect(box.classList.contains('w-[460px]')).toBe(false);    // never fixed-width below md
    expect(box.classList.contains('max-w-full')).toBe(true);    // never wider than a phone viewport
    expect(box.classList.contains('min-w-0')).toBe(true);       // the pill itself may shrink in its flex row
    expect(input.classList.contains('min-w-0')).toBe(true);     // …and so may the input, so text stays inside the pill
    // The row wraps below md so the dropdowns drop to a second line instead of crushing the pill.
    expect(row.classList.contains('flex-wrap')).toBe(true);
    expect(row.classList.contains('md:flex-nowrap')).toBe(true);
  });

  it('keeps the search icon at full size when space is tight', () => {
    renderToolbar();
    const icon = screen.getByLabelText('Search tasks').parentElement!.querySelector('svg')!;
    expect(icon.classList.contains('shrink-0')).toBe(true);
  });

  it('labels the search field and reports typing', () => {
    const setQuery = vi.fn();
    renderToolbar({ setQuery });
    const input = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(input).toHaveAttribute('placeholder', 'Search tasks…');
    fireEvent.change(input, { target: { value: 'spec' } });
    expect(setQuery).toHaveBeenCalledWith('spec');
  });

  it('a dropdown closes on an outside pointerdown', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Hide completed' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Hide completed' })).toBeNull();
  });

  it('is a menu button: aria-haspopup/aria-expanded, first row focused on open', () => {
    renderToolbar();
    const trigger = screen.getByRole('button', { name: /filter/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Filter' });
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Hide completed' }));
  });

  it('Escape closes the menu and returns focus to its trigger', () => {
    renderToolbar();
    const trigger = screen.getByRole('button', { name: /columns/i });
    fireEvent.click(trigger);
    const row = screen.getByRole('menuitemcheckbox', { name: 'Critical' });
    const ev = fireEvent.keyDown(row, { key: 'Escape' });
    // preventDefault (not stopPropagation) so document-level Escape handlers skip it.
    expect(ev).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('arrow keys move between rows, wrapping', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    const rows = screen.getAllByRole('menuitemcheckbox');
    expect(rows).toHaveLength(6);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[5]);
  });

  it('Filter row is a checkbox item reflecting and toggling Hide completed', () => {
    const setHideCompleted = vi.fn();
    renderToolbar({ hideCompleted: true, setHideCompleted });
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    const row = screen.getByRole('menuitemcheckbox', { name: 'Hide completed' });
    expect(row).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(row);
    expect(setHideCompleted).toHaveBeenCalledWith(false);
    // Toggling keeps the menu open.
    expect(screen.getByRole('menu', { name: 'Filter' })).toBeInTheDocument();
  });

  it('Columns lists all six columns with their visibility and toggles one', () => {
    const setColsVisible = vi.fn();
    renderToolbar({ colsVisible: { ...ALL_COLUMNS, backlog: false }, setColsVisible });
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    const names = screen.getAllByRole('menuitemcheckbox').map((r) => r.textContent);
    expect(names).toEqual(['Critical', 'High priority', 'Medium priority', 'Low priority', 'Backlog', 'Completed']);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Backlog' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Critical' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Backlog' }));
    expect(setColsVisible).toHaveBeenCalledWith({ ...ALL_COLUMNS, backlog: true });
  });
});
