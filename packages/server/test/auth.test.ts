import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

describe('auth', () => {
  it('returns a consent URL', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('consent.example');
  });

  it('callback exchanges a code for a JWT', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe('u1');
    expect(typeof res.json().token).toBe('string');
  });

  it('callback without a code is a 400', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback' });
    expect(res.statusCode).toBe(400);
  });

  it('a protected route rejects a missing token with 401', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('a protected route accepts a valid token', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it('callback redirects to the web client with token in the fragment when WEB_CLIENT_URL is set', async () => {
    const { app } = buildTestApp({ webClientUrl: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith('http://localhost:5173/auth/callback#')).toBe(true);
    expect(loc).toContain('userId=u1');
    expect(loc).toContain('token=');
    const params = new URLSearchParams(new URL(loc).hash.slice(1));
    const decoded = app.jwt.verify<{ sub?: string }>(params.get('token') as string);
    expect(decoded.sub).toBe('u1');
  });

  it('rejects a malformed token and a token without a sub with 401', async () => {
    const { app } = buildTestApp();
    await app.ready();
    const garbage = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: 'Bearer not-a-jwt' } });
    expect(garbage.statusCode).toBe(401);
    const noSub = app.jwt.sign({});
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${noSub}` } });
    expect(res.statusCode).toBe(401);
  });

  it('register is rejected in closed mode', async () => {
    const { app } = buildTestApp({ registrationMode: 'closed', users: [] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'new@x.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(403);
  });

  it('register creates a user, default settings, and returns a token in open mode', async () => {
    const { app, users, settings } = buildTestApp({ registrationMode: 'open', users: [] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'New@X.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
    const uid = res.json().userId;
    expect(await users.findByEmail('new@x.com')).toMatchObject({ id: uid }); // normalized
    expect(await settings.getByUserId(uid)).not.toBeNull();
  });

  it('register requires a valid invite in invite mode', async () => {
    const bad = buildTestApp({ registrationMode: 'invite', users: [], validInvites: [] });
    const r1 = await bad.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@x.com', password: 'longenough1', inviteCode: 'NOPE' } });
    expect(r1.statusCode).toBe(403);
    const good = buildTestApp({ registrationMode: 'invite', users: [], validInvites: ['GOOD'] });
    const r2 = await good.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@x.com', password: 'longenough1', inviteCode: 'GOOD' } });
    expect(r2.statusCode).toBe(200);
    expect(good.invites.consumed).toContain('GOOD');
  });

  it('register rejects a duplicate email', async () => {
    const { app } = buildTestApp({ registrationMode: 'open', users: [{ id: 'u9', email: 'dup@x.com', passwordHash: null, isAdmin: false, googleId: null, googleRefreshToken: null, autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'dup@x.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(409);
  });
});
