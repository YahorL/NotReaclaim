import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { AccountSection } from './AccountSection';

afterEach(() => { vi.unstubAllGlobals(); });

const disconnected = async () => ({ connected: false, brokenAt: null });

describe('AccountSection', () => {
  it('sets a password', async () => {
    const setPassword = vi.fn(async () => undefined);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ setPassword, getGoogleStatus: disconnected }) });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('longenough1'));
  });

  it('starts the Connect Google flow when not connected', async () => {
    const getLinkGoogleUrl = vi.fn(async () => ({ url: 'https://consent.example/x' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ getLinkGoogleUrl, getGoogleStatus: disconnected }) });
    fireEvent.click(await screen.findByRole('button', { name: /connect google/i }));
    await waitFor(() => expect(getLinkGoogleUrl).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://consent.example/x'));
  });

  it('shows a connected indicator instead of Connect when the link is healthy', async () => {
    renderWithProviders(<AccountSection />, {
      api: fakeApiClient({ getGoogleStatus: async () => ({ connected: true, brokenAt: null }) }),
    });
    expect(await screen.findByTestId('google-connected')).toHaveTextContent(/connected/i);
    expect(screen.queryByRole('button', { name: /^connect google/i })).toBeNull();
  });

  it('offers Reconnect when the connection is broken', async () => {
    const getLinkGoogleUrl = vi.fn(async () => ({ url: 'https://consent.example/again' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    renderWithProviders(<AccountSection />, {
      api: fakeApiClient({ getLinkGoogleUrl, getGoogleStatus: async () => ({ connected: true, brokenAt: '2026-08-24T10:00:00.000Z' }) }),
    });
    expect(await screen.findByTestId('google-broken')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://consent.example/again'));
  });
});
