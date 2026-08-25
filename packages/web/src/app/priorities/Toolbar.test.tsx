import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
  it('lets the search box shrink below its 430px desktop width', () => {
    renderToolbar();
    const input = screen.getByLabelText('Search tasks');
    const box = input.parentElement!;
    expect(box.className).toContain('w-[430px]');   // desktop width preserved
    expect(box.className).toContain('max-w-full');  // never wider than a phone viewport
    expect(box.className).toContain('min-w-0');     // the pill itself may shrink in its flex row
    expect(input.className).toContain('min-w-0');   // …and so may the input, so text stays inside the pill
  });
});
