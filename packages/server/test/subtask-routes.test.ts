import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';
import type { Task } from '@notreclaim/db';

const seededTask = { id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1, categoryId: null, notBefore: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [] } as unknown as Task;

describe('subtask routes', () => {
  it('creates a subtask under the user\'s task', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/subtasks', headers: { authorization: `Bearer ${token}` }, payload: { taskId: 't1', title: 'step 1' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ taskId: 't1', title: 'step 1', done: false });
  });

  it('patches and deletes a subtask', async () => {
    const { app, reconcileCalls } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1', title: 's' } });
    const id = (created.json() as { id: string }).id;
    const patched = await app.inject({ method: 'PATCH', url: `/subtasks/${id}`, headers: auth, payload: { done: true } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ done: true });
    const del = await app.inject({ method: 'DELETE', url: `/subtasks/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    expect(reconcileCalls).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const { app } = buildTestApp();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/subtasks', payload: { taskId: 't1', title: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a bad body (400) and a subtask under another user\'s task (404)', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const bad = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1' } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 'nope', title: 'x' } });
    expect(missing.statusCode).toBe(404);
  });
});
