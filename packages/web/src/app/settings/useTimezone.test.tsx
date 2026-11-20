import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { useSettingsQuery } from '../../api/queries';
import { isSupportedZone, supportedZoneOr, useTimezone } from './useTimezone';

// A name the server's (newer) ICU could accept but this runtime's Intl does not know.
const UNKNOWN_ZONE = 'Mars/Olympus_Mons';

describe('isSupportedZone', () => {
  it('is true for zones this runtime formats and false for ones Intl rejects', () => {
    expect(isSupportedZone('America/New_York')).toBe(true);
    expect(isSupportedZone('UTC')).toBe(true);
    expect(isSupportedZone(UNKNOWN_ZONE)).toBe(false);
    expect(isSupportedZone('')).toBe(false);
  });

  it('agrees with what Intl.DateTimeFormat itself does', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: UNKNOWN_ZONE })).toThrow(RangeError);
  });
});

describe('supportedZoneOr', () => {
  it('passes a supported zone through', () => {
    expect(supportedZoneOr('Asia/Tokyo', 'Europe/Paris')).toBe('Asia/Tokyo');
  });

  it('falls back when the zone is missing or unsupported', () => {
    expect(supportedZoneOr(undefined, 'Europe/Paris')).toBe('Europe/Paris');
    expect(supportedZoneOr(UNKNOWN_ZONE, 'Europe/Paris')).toBe('Europe/Paris');
  });
});

function ZoneProbe() {
  const loaded = useSettingsQuery().data?.timezone ?? '';
  return <><span data-testid="loaded">{loaded}</span><span data-testid="zone">{useTimezone()}</span></>;
}

const settings = (timezone: string) => ({
  id: 's', userId: 'u', timezone, workingHours: [], horizonDays: 14,
  defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000, createdAt: '', updatedAt: '',
});

describe('useTimezone', () => {
  it('returns the settings zone once it loads', async () => {
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(settings('Asia/Tokyo')) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    await waitFor(() => expect(screen.getByTestId('zone')).toHaveTextContent('Asia/Tokyo'));
  });

  it('keeps the browser zone when this browser does not support the settings zone', async () => {
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(settings(UNKNOWN_ZONE)) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent(UNKNOWN_ZONE));
    expect(screen.getByTestId('zone')).toHaveTextContent('UTC'); // the test runner's TZ
  });
});
