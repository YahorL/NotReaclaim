import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { ApiError } from '../../api/client';
import { CategoriesSection } from './CategoriesSection';

const cats = [
  { id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, color: null, isDefault: true },
  { id: 'cat-p', userId: 'u', name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }], color: null, isDefault: false },
];

describe('CategoriesSection', () => {
  it('lists categories and disables deleting the default', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    // Names are now inline inputs; use findByDisplayValue
    expect(await screen.findByDisplayValue('Working Hours')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Personal')).toBeInTheDocument();
    expect(screen.getByTestId('delete-cat-def')).toBeDisabled();
    expect(screen.getByTestId('delete-cat-p')).not.toBeDisabled();
  });

  it('creates a category from the form', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'cat-n', userId: 'u', name: 'Deep Work', windows: [], color: null, isDefault: false });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle')); // enable Monday
    fireEvent.click(screen.getByTestId('save-new-category'));
    await waitFor(() => expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Deep Work' })));
  });

  it('PATCHes category name on blur when changed', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ ...cats[1], name: 'Work' });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    const nameInput = await screen.findByTestId('cat-name-cat-p');
    fireEvent.change(nameInput, { target: { value: 'Work' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('cat-p', { name: 'Work' }));
  });

  it('does not PATCH name when unchanged', async () => {
    const updateCategory = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    const nameInput = await screen.findByTestId('cat-name-cat-p');
    fireEvent.blur(nameInput); // blur without change
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('does not PATCH name when input is empty', async () => {
    const updateCategory = vi.fn();
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    const nameInput = await screen.findByTestId('cat-name-cat-p');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.blur(nameInput);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('PATCHes color when a color swatch is clicked', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ ...cats[1], color: '#4285f4' });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    await screen.findByTestId('cat-row-cat-p');
    fireEvent.click(screen.getByTestId('cat-color-cat-p-#4285f4'));
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('cat-p', { color: '#4285f4' }));
  });

  it('PATCHes color to null when the none swatch is clicked', async () => {
    const catWithColor = { ...cats[1], color: '#4285f4' };
    const updateCategory = vi.fn().mockResolvedValue({ ...catWithColor, color: null });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0], catWithColor]), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    await screen.findByTestId('cat-row-cat-p');
    fireEvent.click(screen.getByTestId('cat-color-cat-p-none'));
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('cat-p', { color: null }));
  });

  it('default-category toggle: unchecked PATCHes windows:null, checked shows editor', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ ...cats[0], windows: null });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    // Default category initially shows toggle unchecked (windows is null → inherit)
    const toggle = await screen.findByTestId('cat-default-custom');
    expect(toggle).not.toBeChecked();
    // Check the toggle → shows WeeklyHoursEditor
    fireEvent.click(toggle);
    expect(screen.getByTestId('cat-default-custom')).toBeChecked();
    // Uncheck → PATCHes windows:null
    fireEvent.click(toggle);
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('cat-def', { windows: null }));
  });

  it('a rejected hours save shows the error in that row; a later successful save clears it', async () => {
    const updateCategory = vi.fn()
      .mockRejectedValueOnce(new ApiError(400, 'validation_error', 'startMinute must be before endMinute'))
      .mockResolvedValueOnce(cats[1]);
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('save-cat-p'));
    await waitFor(() => expect(screen.getByTestId('cat-error-cat-p')).toHaveTextContent('startMinute must be before endMinute'));
    expect(screen.queryByTestId('cat-error-cat-def')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save-cat-p'));
    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('cat-error-cat-p')).not.toBeInTheDocument());
  });

  it('a failed delete (network error) shows an error in that row', async () => {
    const deleteCategory = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), deleteCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('delete-cat-p'));
    await waitFor(() => expect(screen.getByTestId('cat-error-cat-p')).toHaveTextContent(/couldn't save/i));
  });

  it('a rejected create shows the error and keeps the form open', async () => {
    const createCategory = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'A category with that name exists'));
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle'));
    fireEvent.click(screen.getByTestId('save-new-category'));
    await waitFor(() => expect(screen.getByTestId('new-category-error')).toHaveTextContent('A category with that name exists'));
    expect(screen.getByTestId('cat-name-input')).toHaveValue('Deep Work');
  });

  it('a failed delete followed by a successful update in that row clears the error', async () => {
    const deleteCategory = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'Category is in use'));
    const updateCategory = vi.fn().mockResolvedValue({ ...cats[1], color: '#4285f4' });
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), deleteCategory, updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('delete-cat-p'));
    await waitFor(() => expect(screen.getByTestId('cat-error-cat-p')).toHaveTextContent('Category is in use'));
    fireEvent.click(screen.getByTestId('cat-color-cat-p-#4285f4'));
    await waitFor(() => expect(updateCategory).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('cat-error-cat-p')).not.toBeInTheDocument());
  });

  it('cancelling the add form after a failed create drops the stale error', async () => {
    const createCategory = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'A category with that name exists'));
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle'));
    fireEvent.click(screen.getByTestId('save-new-category'));
    await screen.findByTestId('new-category-error');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('add-category'));
    expect(screen.queryByTestId('new-category-error')).not.toBeInTheDocument();
  });

  it('a create that fails after the form was cancelled does not resurface when the form is reopened', async () => {
    let rejectCreate!: (e: unknown) => void;
    const createCategory = vi.fn(() => new Promise((_res, rej) => { rejectCreate = rej; }));
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0]]), createCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('add-category'));
    fireEvent.change(screen.getByTestId('cat-name-input'), { target: { value: 'Deep Work' } });
    fireEvent.click(screen.getByTestId('newcat-1-toggle'));
    fireEvent.click(screen.getByTestId('save-new-category'));
    await waitFor(() => expect(createCategory).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); // still in flight
    rejectCreate(new ApiError(409, 'conflict', 'A category with that name exists'));
    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle
    fireEvent.click(screen.getByTestId('add-category'));
    expect(screen.queryByTestId('new-category-error')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('new-category-error')).not.toBeInTheDocument();
  });

  it('shows Default / Follows Settings chips for an inheriting default and an hours total for custom windows', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    await screen.findByTestId('cat-row-cat-p');
    expect(screen.getByTestId('cat-default-chip-cat-def')).toHaveTextContent('Default');
    expect(screen.getByTestId('cat-weekly-cat-def')).toHaveTextContent('Follows Settings');
    expect(screen.queryByTestId('cat-default-chip-cat-p')).toBeNull();
    expect(screen.getByTestId('cat-weekly-cat-p')).toHaveTextContent('4h per week'); // Mon 18:00–22:00
    // the inheriting default links to Settings for its hours
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('the weekly total follows unsaved edits', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    await screen.findByTestId('cat-row-cat-p');
    fireEvent.click(screen.getByTestId('cat-cat-p-2-toggle')); // enable Tuesday (prefilled 09:00–17:00)
    expect(screen.getByTestId('cat-weekly-cat-p')).toHaveTextContent('12h per week');
  });

  it('turning on custom hours for the default swaps "Follows Settings" for a total', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    fireEvent.click(await screen.findByTestId('cat-default-custom'));
    expect(screen.getByTestId('cat-weekly-cat-def')).toHaveTextContent('0h per week');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('colour swatches are a radio group with the current colour checked', async () => {
    const catWithColor = { ...cats[1], color: '#4285f4' };
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([cats[0], catWithColor]) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    const group = await screen.findByRole('radiogroup', { name: 'Personal color' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(9);
    expect(within(group).getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'Indigo' })).toHaveAttribute('aria-checked', 'false');
    expect(within(screen.getByRole('radiogroup', { name: 'Working Hours color' })).getByRole('radio', { name: 'No color' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('arrow keys move focus between swatches without changing the colour; Space/click selects', async () => {
    const updateCategory = vi.fn().mockResolvedValue(cats[1]);
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats), updateCategory } as never);
    renderWithProviders(<CategoriesSection />, { api });
    const group = await screen.findByRole('radiogroup', { name: 'Personal color' });
    const none = within(group).getByRole('radio', { name: 'No color' });
    expect(none).toHaveAttribute('tabindex', '0');
    expect(within(group).getByRole('radio', { name: 'Indigo' })).toHaveAttribute('tabindex', '-1');
    none.focus();
    fireEvent.keyDown(none, { key: 'ArrowRight' }); // wraps to the first swatch
    expect(within(group).getByRole('radio', { name: 'Indigo' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(none).toHaveFocus();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('draws a coverage bar per day in each hours editor', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue(cats) } as never);
    renderWithProviders(<CategoriesSection />, { api });
    await screen.findByTestId('cat-row-cat-p');
    const mon = screen.getByTestId('cat-cat-p-1-bar');
    expect(mon.style.left).toBe('75%'); // 18:00
    expect(mon.style.width).toBe(`${(4 / 24) * 100}%`);
  });
});
