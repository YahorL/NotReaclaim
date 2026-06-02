import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { CategoriesSection } from './CategoriesSection';

const cats = [
  { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true },
  { id: 'cat-p', userId: 'u', name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }], isDefault: false },
];

describe('CategoriesSection', () => {
  it('lists categories and disables deleting the default', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    expect(await screen.findByText('Working Hours')).toBeInTheDocument();
    expect(await screen.findByText('Personal')).toBeInTheDocument();
    expect(screen.getByTestId('delete-cat-def')).toBeDisabled();
    expect(screen.getByTestId('delete-cat-p')).not.toBeDisabled();
  });

  it('creates a category from the form', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-n', userId: 'u', name: 'Deep Work', windows: [], isDefault: false });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle')); // enable Monday
    fireEvent.click(screen.getByTestId('save-new-category'));
    await waitFor(() => expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Deep Work' })));
  });
});
