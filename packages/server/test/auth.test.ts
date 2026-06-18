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

  it('login succeeds with correct credentials and fails generically otherwise', async () => {
    // Register first (open mode) so a passwordHash exists.
    const ctx = buildTestApp({ registrationMode: 'open', users: [] });
    await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'log@x.com', password: 'longenough1' } });

    const ok = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'log@x.com', password: 'longenough1' } });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().token).toBe('string');

    const wrong = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'log@x.com', password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    const missing = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ghost@x.com', password: 'whatever' } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().message).toBe(wrong.json().message); // no user enumeration
  });

  it('set-password lets a google-only user then log in with email+password', async () => {
    const ctx = buildTestApp({
      registrationMode: 'open',
      users: [{ id: 'u1', email: 'g@x.com', passwordHash: null, isAdmin: false, googleId: 'g-1', googleRefreshToken: 'enc', autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never],
    });
    const token = await tokenFor(ctx.app, 'u1');
    const set = await ctx.app.inject({ method: 'POST', url: '/auth/set-password', headers: { authorization: `Bearer ${token}` }, payload: { password: 'brandnewpw1' } });
    expect(set.statusCode).toBe(204);
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'g@x.com', password: 'brandnewpw1' } });
    expect(login.statusCode).toBe(200);
  });

  it('set-password requires auth', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/auth/set-password', payload: { password: 'longenough1' } });
    expect(res.statusCode).toBe(401);
  });

  it('change-email updates the account email', async () => {
    const ctx = buildTestApp({ users: [{ id: 'u1', email: 'old@x.com', passwordHash: null, isAdmin: false, googleId: null, googleRefreshToken: null, autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const token = await tokenFor(ctx.app, 'u1');
    const res = await ctx.app.inject({ method: 'PATCH', url: '/auth/email', headers: { authorization: `Bearer ${token}` }, payload: { email: 'New@X.com' } });
    expect(res.statusCode).toBe(200);
    expect((await ctx.users.findById('u1'))?.email).toBe('new@x.com');
  });
});
