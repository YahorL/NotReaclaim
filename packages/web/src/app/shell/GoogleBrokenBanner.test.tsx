import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { GoogleBrokenBanner } from './GoogleBrokenBanner';

afterEach(() => { vi.unstubAllGlobals(); });

describe('GoogleBrokenBanner', () => {
  it('renders nothing while the status is unknown', () => {
    renderWithProviders(<GoogleBrokenBanner />, {
      api: fakeApiClient({ getGoogleStatus: () => new Promise(() => {}) }),
    });
    expect(screen.queryByTestId('google-broken-banner')).toBeNull();
  });

  it('renders nothing for a healthy connection', async () => {
    renderWithProviders(<GoogleBrokenBanner />, {
      api: fakeApiClient({ getGoogleStatus: async () => ({ connected: true, brokenAt: null }) }),
    });
    await waitFor(() => expect(screen.queryByTestId('google-broken-banner')).toBeNull());
  });

  it('renders nothing when Google was never connected', async () => {
    renderWithProviders(<GoogleBrokenBanner />, {
      api: fakeApiClient({ getGoogleStatus: async () => ({ connected: false, brokenAt: null }) }),
    });
    await waitFor(() => expect(screen.queryByTestId('google-broken-banner')).toBeNull());
  });

  it('alerts and offers a reconnect when the connection is broken', async () => {
    const getLinkGoogleUrl = vi.fn(async () => ({ url: 'https://consent.example/again' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    renderWithProviders(<GoogleBrokenBanner />, {
      api: fakeApiClient({ getLinkGoogleUrl, getGoogleStatus: async () => ({ connected: true, brokenAt: '2026-08-24T10:00:00.000Z' }) }),
    });

    const banner = await screen.findByTestId('google-broken-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent(/google calendar sync is broken/i);
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://consent.example/again'));
    expect(screen.queryByTestId('google-link-error')).toBeNull();
  });

  it('says so when the reconnect cannot be started', async () => {
    // Without this the button is inert under a banner that promises recovery.
    renderWithProviders(<GoogleBrokenBanner />, {
      api: fakeApiClient({
        getLinkGoogleUrl: async () => { throw new Error('offline'); },
        getGoogleStatus: async () => ({ connected: true, brokenAt: '2026-08-24T10:00:00.000Z' }),
      }),
    });

    await screen.findByTestId('google-broken-banner');
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(await screen.findByTestId('google-link-error')).toHaveTextContent(/could not start/i);
  });
});
