import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const windows = [{ weekday: 1, startMinute: 1080, endMinute: 1320 }];

describe('category routes', () => {
  it('GET /categories ensures and returns a default category', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ name: string; isDefault: boolean }>;
    expect(list.some((c) => c.isDefault && c.name === 'Working Hours')).toBe(true);
  });

  it('POST /categories creates a category and triggers a re-plan', async () => {
    const { app, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Personal', windows },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Personal', isDefault: false });
    expect(reconcileCalls).toHaveLength(1);
  });

  it('rejects invalid windows with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bad', windows: [{ weekday: 9, startMinute: 0, endMinute: 10 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when deleting the default category', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const def = await categories.ensureDefault('u1');
    const res = await app.inject({ method: 'DELETE', url: `/categories/${def.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for another user\'s category', async () => {
    const { app } = buildTestApp({ categories: [{ id: 'cat-x', userId: 'other', name: 'X', windows: null, isDefault: false, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'PATCH', url: '/categories/cat-x', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Y' } });
    expect(res.statusCode).toBe(404);
  });
});
