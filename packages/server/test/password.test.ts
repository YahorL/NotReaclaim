import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password', () => {
  it('hashes to something that is not the plaintext', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).not.toBe('correct horse battery staple');
    expect(h.length).toBeGreaterThan(20);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('s3cret-passw0rd');
    expect(await verifyPassword(h, 's3cret-passw0rd')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('verifyPassword returns false on a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
