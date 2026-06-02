import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const taskBody = {
  title: 'Write report', priority: 1, durationMs: 3600000,
  dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000,
};

describe('task routes', () => {
  it('creates, fetches, lists, updates, and deletes a task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const got = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe('Write report');

    const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth });
    expect(list.json()).toHaveLength(1);

    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 5 } });
    expect(patched.json().priority).toBe(5);

    const del = await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('returns 404 for a missing task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid body with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: { title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('scopes tasks by user', async () => {
    const { app } = buildTestApp();
    const tokenA = await tokenFor(app, 'userA');
    const tokenB = await tokenFor(app, 'userB');
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${tokenA}` }, payload: taskBody });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a missing task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/tasks/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('emits task.changed (created) and triggers a re-plan on create', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({
      method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: taskBody,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'created' });
    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
  });

  it('emits task.changed (updated) on patch and (deleted) on delete', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody })).json().id;

    await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 4 } });
    await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'updated' });
    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'deleted' });
    expect(reconcileCalls).toHaveLength(3); // create + patch + delete
  });

  it('does not emit or re-plan on GET', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });

    expect(emitted).toEqual([]);
    expect(reconcileCalls).toEqual([]);
  });

  it('round-trips categoryId on task create and update', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const createRes = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: { ...taskBody, categoryId: 'cat-1' } });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json()).toMatchObject({ categoryId: 'cat-1' });
    const id = (createRes.json() as { id: string }).id;
    const patchRes = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { categoryId: 'cat-2' } });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({ categoryId: 'cat-2' });
  });
});
