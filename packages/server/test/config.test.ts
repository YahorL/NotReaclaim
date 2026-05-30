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
});
