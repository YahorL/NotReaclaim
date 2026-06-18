import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { Register } from './Register';

beforeEach(() => localStorage.clear());

describe('Register', () => {
  it('registers and stores the token', async () => {
    vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const register = vi.fn(async () => ({ token: 't', userId: 'u' }));
    renderWithProviders(<Register />, { api: fakeApiClient({ register }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(localStorage.getItem('notreclaim.auth')).toContain('"token":"t"');
  });

  it('surfaces a closed-registration message', async () => {
    const register = vi.fn(async () => { const { ApiError } = await import('../api/client'); throw new ApiError(403, 'registration_closed', 'Registration is closed'); });
    renderWithProviders(<Register />, { api: fakeApiClient({ register }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument();
  });
});
