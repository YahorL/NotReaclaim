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
});
