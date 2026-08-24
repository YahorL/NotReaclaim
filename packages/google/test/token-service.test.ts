import { describe, it, expect } from 'vitest';
import { createTokenService } from '../src/token-service.js';
import { decryptToken, encryptToken } from '../src/encryption.js';
import { GoogleAuthError, GoogleGrantRevokedError, GoogleNotConnectedError } from '../src/errors.js';
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

  it('getAccessToken marks the user broken and reports the transition when the grant is revoked', async () => {
    const client = new FakeGoogleClient();
    client.refreshError = new GoogleGrantRevokedError('invalid_grant');
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
    client.refreshError = new GoogleGrantRevokedError('invalid_grant');
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

  it('getAccessToken leaves the flag alone when the refresh fails transiently', async () => {
    // A Google outage or a DNS blip is not the user's problem: flagging it would raise a
    // false app-wide "reconnect" alert that only self-heals on the next successful refresh.
    const client = new FakeGoogleClient();
    client.refreshError = new GoogleAuthError('getaddrinfo ENOTFOUND oauth2.googleapis.com');
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: unknown[] = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: () => transitions.push(1),
    });

    await expect(svc.getAccessToken('u1', 1000)).rejects.toBeInstanceOf(GoogleAuthError);
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toBeNull();
    expect(transitions).toEqual([]);
  });

  it('getAccessToken leaves the flag alone when the refresh fails for a non-auth reason', async () => {
    const client = new FakeGoogleClient();
    client.refreshError = new Error('boom');
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: unknown[] = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: () => transitions.push(1),
    });

    await expect(svc.getAccessToken('u1', 1000)).rejects.toThrow('boom');
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toBeNull();
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

  it('getAccessToken announces a break once when two refreshes fail concurrently', async () => {
    // Both callers (poll timer + a mutation replan) read a healthy user before either failure
    // lands, so the decision has to be the conditional write itself, not the stale snapshot.
    const client = new FakeGoogleClient();
    client.refreshError = new GoogleGrantRevokedError('invalid_grant');
    let release!: () => void;
    client.refreshGate = new Promise<void>((r) => { release = r; });
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: Array<{ userId: string; broken: boolean }> = [];
    const build = () => createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: (userId, broken) => transitions.push({ userId, broken }),
    });

    const settled = Promise.allSettled([build().getAccessToken('u1', 1000), build().getAccessToken('u1', 2000)]);
    release();
    await settled;

    expect(transitions).toEqual([{ userId: 'u1', broken: true }]);
    expect((await users.findById('u1'))?.googleAuthBrokenAt).toEqual(new Date(1000)); // first failure wins
  });

  it('getAccessToken clears a flag that was set while its own refresh was in flight', async () => {
    // The stuck-broken case: this caller read a healthy user, someone else marked it broken,
    // and a snapshot-driven clear would then skip — leaving a permanent false alert.
    const client = new FakeGoogleClient();
    let release!: () => void;
    client.refreshGate = new Promise<void>((r) => { release = r; });
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: encryptToken('refresh-1', key) })]);
    const transitions: Array<{ userId: string; broken: boolean }> = [];
    const svc = createTokenService({
      client, users, encryptionKey: key,
      onAuthStatusChange: (userId, broken) => transitions.push({ userId, broken }),
    });

    const pending = svc.getAccessToken('u1', 1000);
    await users.setGoogleAuthBroken('u1', new Date(500));
    release();

    expect(await pending).toBe('access-refreshed');
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
