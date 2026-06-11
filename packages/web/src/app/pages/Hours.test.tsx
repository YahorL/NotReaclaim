import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Hours } from './Hours';

describe('Hours page', () => {
  it('renders the categories section', async () => {
    const listCategories = vi.fn().mockResolvedValue([
      { id: 'cat-1', userId: 'u1', name: 'Work', windows: null, isDefault: true, color: null },
    ]);
    const api = fakeApiClient({ listCategories } as never);
    renderWithProviders(<Hours />, { api });
    await waitFor(() => expect(screen.getByTestId('categories-section')).toBeInTheDocument());
  });

  it('renders a page heading', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<Hours />, { api });
    expect(screen.getByRole('heading', { name: /hours/i })).toBeInTheDocument();
  });
});
