import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import type { BoardColumnKey } from './priorityBucket';
import { Toolbar } from './Toolbar';

const ALL_COLUMNS: Record<BoardColumnKey, boolean> = {
  critical: true, high: true, medium: true, low: true, backlog: true, completed: true,
};

function renderToolbar() {
  renderWithProviders(
    <Toolbar
      query="" setQuery={vi.fn()}
      hideCompleted={false} setHideCompleted={vi.fn()}
      colsVisible={ALL_COLUMNS} setColsVisible={vi.fn()}
    />,
  );
}

describe('Priorities Toolbar', () => {
  it('gives the search box its own full-width row below md, 430px at md+', () => {
    renderToolbar();
    const input = screen.getByLabelText('Search tasks');
    const box = input.parentElement!;
    const row = box.parentElement!;
    // Exact tokens: `toContain('w-[430px]')` would false-match `md:w-[430px]`.
    expect(box.classList.contains('w-full')).toBe(true);        // full width on a phone…
    expect(box.classList.contains('md:w-[430px]')).toBe(true);  // …desktop width preserved
    expect(box.classList.contains('w-[430px]')).toBe(false);    // never fixed-width below md
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

  it('a dropdown closes on an outside pointerdown', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('Hide completed')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Hide completed')).toBeNull();
  });
});
