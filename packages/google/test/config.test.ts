import { describe, it, expect } from 'vitest';
import { decodeEncryptionKey, loadGoogleConfig } from '../src/config.js';

describe('config', () => {
  it('decodes a valid 32-byte base64 key', () => {
    const raw = Buffer.alloc(32, 1).toString('base64');
    expect(decodeEncryptionKey(raw).length).toBe(32);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => decodeEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('loadGoogleConfig throws when a required var is missing', () => {
    expect(() => loadGoogleConfig({})).toThrow();
  });

  it('loadGoogleConfig returns a typed config when all vars are present', () => {
    const config = loadGoogleConfig({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:8123/oauth/callback',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(config.clientId).toBe('id');
    expect(config.encryptionKey.length).toBe(32);
  });
});
