import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { useSettingsQuery } from '../../api/queries';
import { isSupportedZone, resolveSettingsZone, supportedZoneOr, useTimezone } from './useTimezone';

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

// A zone in a real IANA area that this runtime's Intl does not know: what a zone added to IANA
// after this browser's ICU looks like (the server, with a newer ICU, may accept it).
const NEWER_ZONE = 'America/Not_Yet_Listed';

describe('resolveSettingsZone: the web half of core isValidTimezone (the server plans an invalid stored zone in UTC)', () => {
  const BROWSER = 'Europe/Paris';

  it('settings not loaded yet → the browser zone', () => {
    expect(resolveSettingsZone(undefined, BROWSER)).toBe(BROWSER);
  });

  it.each(['America/New_York', 'UTC', 'GMT', 'Etc/GMT+5', 'Asia/Calcutta', 'Europe/Kiev', 'US/Pacific', 'America/Argentina/Buenos_Aires'])(
    'a valid zone (%s) is used as is', (zone) => {
      expect(resolveSettingsZone(zone, BROWSER)).toBe(zone);
    },
  );

  it.each(['Not/AZone', 'local', '+03:00', '', 'Fantasia/Castle', 'New York', ' America/New_York', 'system', 'UTC+3', '-05:00'])(
    'a zone the server rejects (%j) → UTC, as the server plans it', (zone) => {
      expect(resolveSettingsZone(zone, BROWSER)).toBe('UTC');
    },
  );

  it('a zone in a real IANA area that this browser does not know → the browser zone (the server may know it)', () => {
    expect(isSupportedZone(NEWER_ZONE)).toBe(false);
    expect(resolveSettingsZone(NEWER_ZONE, BROWSER)).toBe(BROWSER);
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
  // The runner's TZ is UTC, which would hide a browser-zone vs UTC fallback mix-up.
  const browserIsParis = () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: 'Europe/Paris' };
    });
  };
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the settings zone once it loads', async () => {
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(settings('Asia/Tokyo')) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    await waitFor(() => expect(screen.getByTestId('zone')).toHaveTextContent('Asia/Tokyo'));
  });

  it('keeps the browser zone when this browser does not support the (valid) settings zone', async () => {
    browserIsParis();
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(settings(NEWER_ZONE)) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent(NEWER_ZONE));
    expect(screen.getByTestId('zone')).toHaveTextContent('Europe/Paris');
  });

  it('renders in UTC, like the server plans, when the stored zone is invalid', async () => {
    browserIsParis();
    const api = fakeApiClient({ getSettings: vi.fn().mockResolvedValue(settings('Not/AZone')) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('Not/AZone'));
    expect(screen.getByTestId('zone')).toHaveTextContent(/^UTC$/);
  });

  it('uses the browser zone until settings load', () => {
    browserIsParis();
    const api = fakeApiClient({ getSettings: () => new Promise(() => {}) } as never);
    renderWithProviders(<ZoneProbe />, { api });
    expect(screen.getByTestId('zone')).toHaveTextContent('Europe/Paris');
  });
});
