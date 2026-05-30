import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';
import { renderWithProviders, fakeApiClient } from '../test/fakes';

beforeEach(() => localStorage.clear());

describe('SignIn', () => {
  it('redirects to the Google consent URL on click', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const api = fakeApiClient({ getConsentUrl: async () => ({ url: 'https://accounts.google/consent' }) });

    renderWithProviders(<SignIn />, { api });
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google/consent'));
  });
});
