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

  it('logs in with email + password and stores the token', async () => {
    vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const login = vi.fn(async () => ({ token: 't', userId: 'u' }));
    renderWithProviders(<SignIn />, { api: fakeApiClient({ login }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in$/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'a@x.com', password: 'longenough1' }));
    expect(JSON.parse(localStorage.getItem('notreclaim.auth')!)).toMatchObject({ token: 't', userId: 'u' });
  });

  it('shows an error on bad credentials', async () => {
    const login = vi.fn(async () => { const { ApiError } = await import('../api/client'); throw new ApiError(401, 'invalid_credentials', 'Invalid email or password'); });
    renderWithProviders(<SignIn />, { api: fakeApiClient({ login }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in$/i }));
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });
});
