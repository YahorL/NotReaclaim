import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/encryption.js';

const key = Buffer.alloc(32, 7);

describe('token encryption', () => {
  it('round-trips plaintext and does not store it in the clear', () => {
    const ct = encryptToken('refresh-abc', key);
    expect(ct).not.toContain('refresh-abc');
    expect(decryptToken(ct, key)).toBe('refresh-abc');
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptToken('x', key)).not.toBe(encryptToken('x', key));
  });

  it('throws with the wrong key', () => {
    const ct = encryptToken('secret', key);
    expect(() => decryptToken(ct, Buffer.alloc(32, 9))).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const ct = encryptToken('secret', key);
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptToken(buf.toString('base64'), key)).toThrow();
  });
});
