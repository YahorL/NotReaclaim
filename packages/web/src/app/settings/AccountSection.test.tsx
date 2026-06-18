import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { AccountSection } from './AccountSection';

afterEach(() => { vi.unstubAllGlobals(); });

describe('AccountSection', () => {
  it('sets a password', async () => {
    const setPassword = vi.fn(async () => undefined);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ setPassword }) });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('longenough1'));
  });

  it('starts the Connect Google flow', async () => {
    const getLinkGoogleUrl = vi.fn(async () => ({ url: 'https://consent.example/x' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ getLinkGoogleUrl }) });
    fireEvent.click(screen.getByRole('button', { name: /connect google/i }));
    await waitFor(() => expect(getLinkGoogleUrl).toHaveBeenCalled());
  });
});
