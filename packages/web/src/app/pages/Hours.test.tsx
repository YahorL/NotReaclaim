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

  // The page title ("Your hours") is the shell header's now (routeHeader); the page drops its own.
  it('leaves the page title to the shell header', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<Hours />, { api });
    expect(screen.queryByRole('heading', { level: 2, name: 'Hours' })).toBeNull();
  });
});
