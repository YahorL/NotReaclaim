import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { parseWsAuth } from '../src/ws.js';

async function appWithJwt() {
  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: 'test-secret' });
  await app.ready();
  return app;
}

describe('parseWsAuth', () => {
  it('returns the userId for a valid token', async () => {
    const app = await appWithJwt();
    const token = app.jwt.sign({ sub: 'u1' });
    expect(parseWsAuth(app, { token })).toEqual({ userId: 'u1' });
  });

  it('returns null when the token is missing', async () => {
    const app = await appWithJwt();
    expect(parseWsAuth(app, {})).toBeNull();
  });

  it('returns null for an invalid token', async () => {
    const app = await appWithJwt();
    expect(parseWsAuth(app, { token: 'garbage' })).toBeNull();
  });

  it('returns null for a token with an empty sub', async () => {
    const app = await appWithJwt();
    const token = app.jwt.sign({ sub: '' });
    expect(parseWsAuth(app, { token })).toBeNull();
  });
});
