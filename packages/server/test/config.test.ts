import { describe, it, expect } from 'vitest';
import { loadServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
  it('defaults pollIntervalMs to 300000', () => {
    const cfg = loadServerConfig({ JWT_SECRET: 's' } as NodeJS.ProcessEnv);
    expect(cfg.pollIntervalMs).toBe(300000);
    expect(cfg.port).toBe(3000);
  });

  it('reads POLL_INTERVAL_MS from the environment', () => {
    const cfg = loadServerConfig({ JWT_SECRET: 's', POLL_INTERVAL_MS: '60000' } as NodeJS.ProcessEnv);
    expect(cfg.pollIntervalMs).toBe(60000);
  });

  it('rejects a non-positive POLL_INTERVAL_MS', () => {
    expect(() => loadServerConfig({ JWT_SECRET: 's', POLL_INTERVAL_MS: '0' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('rejects a non-numeric POLL_INTERVAL_MS', () => {
    expect(() => loadServerConfig({ JWT_SECRET: 's', POLL_INTERVAL_MS: 'abc' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('reads WEB_CLIENT_URL when set and defaults it to undefined', () => {
    expect(loadServerConfig({ JWT_SECRET: 's' } as NodeJS.ProcessEnv).webClientUrl).toBeUndefined();
    const cfg = loadServerConfig({ JWT_SECRET: 's', WEB_CLIENT_URL: 'http://localhost:5173' } as NodeJS.ProcessEnv);
    expect(cfg.webClientUrl).toBe('http://localhost:5173');
  });

  it('strips a trailing slash from WEB_CLIENT_URL', () => {
    expect(loadServerConfig({ JWT_SECRET: 's', WEB_CLIENT_URL: 'http://localhost:5173/' } as NodeJS.ProcessEnv).webClientUrl).toBe('http://localhost:5173');
  });

  it('defaults REGISTRATION_MODE to closed and validates the value', () => {
    expect(loadServerConfig({ JWT_SECRET: 's' } as NodeJS.ProcessEnv).registrationMode).toBe('closed');
    expect(loadServerConfig({ JWT_SECRET: 's', REGISTRATION_MODE: 'open' } as NodeJS.ProcessEnv).registrationMode).toBe('open');
    expect(() => loadServerConfig({ JWT_SECRET: 's', REGISTRATION_MODE: 'bogus' } as NodeJS.ProcessEnv)).toThrow();
  });
});
