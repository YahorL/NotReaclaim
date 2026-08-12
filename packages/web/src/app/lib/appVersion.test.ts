import { describe, it, expect } from 'vitest';
import { appVersion, formatAppVersion } from './appVersion';

describe('appVersion', () => {
  it('falls back to "dev" with no build date when the env is empty', () => {
    expect(appVersion({})).toEqual({ version: 'dev', buildDate: null });
  });

  it('reads the injected build args', () => {
    expect(appVersion({ VITE_APP_VERSION: 'a1b2c3d', VITE_BUILD_DATE: '2026-08-12' }))
      .toEqual({ version: 'a1b2c3d', buildDate: '2026-08-12' });
  });

  it('treats "unknown"/blank build dates as absent', () => {
    expect(appVersion({ VITE_APP_VERSION: 'a1b2c3d', VITE_BUILD_DATE: 'unknown' }).buildDate).toBeNull();
    expect(appVersion({ VITE_APP_VERSION: 'a1b2c3d', VITE_BUILD_DATE: '  ' }).buildDate).toBeNull();
  });

  it('treats a blank version as "dev"', () => {
    expect(appVersion({ VITE_APP_VERSION: '' }).version).toBe('dev');
  });

  it('formats with and without a build date', () => {
    expect(formatAppVersion({ version: 'a1b2c3d', buildDate: '2026-08-12' })).toBe('NotReclaim a1b2c3d · built 2026-08-12');
    expect(formatAppVersion({ version: 'dev', buildDate: null })).toBe('NotReclaim dev');
  });

  it('works with no argument (reads import.meta.env safely)', () => {
    const v = appVersion();
    expect(typeof v.version).toBe('string');
    expect(v.version.length).toBeGreaterThan(0);
  });
});
