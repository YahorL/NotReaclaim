import { describe, it, expect } from 'vitest';
import { createTokenService } from '../src/token-service.js';
import { decryptToken, encryptToken } from '../src/encryption.js';
import { GoogleAuthError, GoogleNotConnectedError } from '../src/errors.js';
import { FakeGoogleClient, fakeUserRepo, makeUser } from './fakes.js';

const key = Buffer.alloc(32, 5);

describe('TokenService', () => {
  it('connectFromCode stores an encrypted refresh token and identity', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo();
    const svc = createTokenService({ client, users, encryptionKey: key });

    const user = await svc.connectFromCode('the-code', 'http://localhost/cb');
    expect(user.googleId).toBe('g-123');
    expect(user.email).toBe('a@example.com');
    expect(user.googleRefreshToken).toBeTruthy();
    expect(user.googleRefreshToken).not.toBe('refresh-1');
    expect(decryptToken(user.googleRefreshToken!, key)).toBe('refresh-1');
  });

  it('getAccessToken refreshes, caches, and re-refreshes after expiry', async () => {
    const client = new FakeGoogleClient();
    client.refreshResponses = [
      { accessToken: 'a1', expiresAt: 3_600_000 },
      { accessToken: 'a2', expiresAt: 7_200_000 },
    ];
    const users = fakeUserRepo([makeUser({ id: 'u1', googleId: 'g-123' })]);
    const svc = createTokenService({ client, users, encryptionKey: key });
    await users.update('u1', { googleRefreshToken: encryptToken('refresh-1', key) });

    expect(await svc.getAccessToken('u1', 1000)).toBe('a1');
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 2000)).toBe('a1'); // cached (well before expiry - skew)
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 3_570_000)).toBe('a2'); // within 60s skew of expiry -> refresh
    expect(client.refreshCalls).toBe(2);
  });

  it('getAccessToken throws when the user has no refresh token', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: null })]);
    const svc = createTokenService({ client, users, encryptionKey: key });
    await expect(svc.getAccessToken('u1', 1000)).rejects.toBeInstanceOf(GoogleNotConnectedError);
  });

  it('getAccessToken marks the user broken and reports the transition when the refresh is rejected', async () => {
    const client = new FakeGoogleClient();
    client.refreshError = new GoogleAuthError('invalid_grant');
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: Array<{ userId: string; broken: boolean }> = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: (userId, broken) => transitions.push({ userId, broken }),
    });

    await expect(svc.getAccessToken('u1', 1000)).rejects.toBeInstanceOf(GoogleAuthError);
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toEqual(new Date(1000));
    expect(transitions).toEqual([{ userId: 'u1', broken: true }]);
  });

  it('getAccessToken keeps the original brokenAt and emits nothing on a repeat failure', async () => {
    const client = new FakeGoogleClient();
    client.refreshError = new GoogleAuthError('invalid_grant');
    const users = fakeUserRepo([
      makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key), googleAuthBrokenAt: new Date(500) }),
    ]);
    const transitions: Array<{ userId: string; broken: boolean }> = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: (userId, broken) => transitions.push({ userId, broken }),
    });

    await expect(svc.getAccessToken('u1', 9000)).rejects.toBeInstanceOf(GoogleAuthError);
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toEqual(new Date(500));
    expect(transitions).toEqual([]);
  });

  it('getAccessToken clears a broken flag on a successful refresh and reports the recovery', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([
      makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key), googleAuthBrokenAt: new Date(500) }),
    ]);
    const transitions: Array<{ userId: string; broken: boolean }> = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: (userId, broken) => transitions.push({ userId, broken }),
    });

    expect(await svc.getAccessToken('u1', 1000)).toBe('access-refreshed');
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toBeNull();
    expect(transitions).toEqual([{ userId: 'u1', broken: false }]);
  });

  it('getAccessToken does not write on a healthy refresh', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: unknown[] = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: () => transitions.push(1),
    });

    await svc.getAccessToken('u1', 1000);
    expect(users.updateCalls).toBe(0);
    expect(transitions).toEqual([]);
  });

  it('exchangeCodeForLink returns profile + encrypted refresh token without writing a user', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo();
    const svc = createTokenService({ client, users, encryptionKey: key });
    const out = await svc.exchangeCodeForLink('code', 'http://localhost/cb');
    expect(out.email).toBe('a@example.com');
    expect(out.googleUserId).toBe('g-123');
    expect(out.emailVerified).toBe(true);
    expect(decryptToken(out.encryptedRefreshToken, key)).toBe('refresh-1');
    expect(await users.findByGoogleId('g-123')).toBeNull(); // no DB write
  });
});
