import { describe, it, expect } from 'vitest';
import type { Category } from '@notreclaim/db';
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
    const { app } = buildTestApp({ categories: [{ id: 'cat-x', userId: 'other', name: 'X', windows: null, isDefault: false, createdAt: new Date(0), updatedAt: new Date(0) } as Category] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'PATCH', url: '/categories/cat-x', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Y' } });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { app } = buildTestApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty PATCH body with 400', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const cat = await categories.create('u1', { name: 'Focus', windows });
    const res = await app.inject({ method: 'PATCH', url: `/categories/${cat.id}`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a window whose start is not before its end with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', windows: [{ weekday: 1, startMinute: 600, endMinute: 600 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a category with a color on creation', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Colorful', windows, color: '#5b62e3' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Colorful', color: '#5b62e3' });
  });

  it('rejects an invalid color with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bad Color', windows, color: 'notacolor' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCHes color on a category', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const cat = await categories.create('u1', { name: 'Focus', windows });
    const res = await app.inject({
      method: 'PATCH', url: `/categories/${cat.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { color: '#4285f4' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: '#4285f4' });
  });

  it('PATCHes color to null (none)', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const cat = await categories.create('u1', { name: 'Focus', windows });
    const res = await app.inject({
      method: 'PATCH', url: `/categories/${cat.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { color: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: null });
  });

  it('PATCHes the default category windows to custom array and back to null', async () => {
    const { app, categories } = buildTestApp();
    const token = await tokenFor(app);
    const def = await categories.ensureDefault('u1');

    // Patch default to custom windows
    const res1 = await app.inject({
      method: 'PATCH', url: `/categories/${def.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { windows },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toMatchObject({ isDefault: true, windows });

    // Patch back to null (inherit global)
    const res2 = await app.inject({
      method: 'PATCH', url: `/categories/${def.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { windows: null },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toMatchObject({ isDefault: true, windows: null });
  });
});
