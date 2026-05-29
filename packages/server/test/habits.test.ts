import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const habitBody = { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] };

describe('habit routes', () => {
  it('creates and lists habits', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: habitBody });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/habits', headers: auth });
    expect(list.json()).toHaveLength(1);
  });

  it('404 for a missing habit and 401 without a token', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'GET', url: '/habits/nope', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/habits' })).statusCode).toBe(401);
  });

  it('scopes habits by user', async () => {
    const { app } = buildTestApp();
    const tokenA = await tokenFor(app, 'userA');
    const tokenB = await tokenFor(app, 'userB');
    const created = await app.inject({
      method: 'POST', url: '/habits', headers: { authorization: `Bearer ${tokenA}` },
      payload: { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] },
    });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/habits/${id}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a missing habit', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/habits/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });
});
