import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';
import type { Subtask, Task } from '@notreclaim/db';

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

  it('PATCH subtask with sortOrder updates and returns the new sortOrder', async () => {
    const { app } = buildTestApp({ tasks: [seededTask] });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1', title: 'step 1' } });
    const id = (created.json() as { id: string }).id;
    const patched = await app.inject({ method: 'PATCH', url: `/subtasks/${id}`, headers: auth, payload: { sortOrder: 0.5 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().sortOrder).toBe(0.5);
  });

  describe('realtime: a checklist change announces its parent task (no replan)', () => {
    // Seed both sides: the fake task repo's rows don't pick up subtasks created through the
    // fake subtask repo, whereas the real listByUser includes them.
    const sub = { id: 'sub-x', taskId: 't1', title: 'step', done: false, sortOrder: 1, createdAt: new Date(0), updatedAt: new Date(0) } as Subtask;
    const setup = async () => {
      const ctx = buildTestApp({ tasks: [{ ...seededTask, subtasks: [sub] } as Task], subtasks: [sub] });
      return { ...ctx, auth: { authorization: `Bearer ${await tokenFor(ctx.app)}` } };
    };
    const changed = { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'updated' };

    it('POST /subtasks emits task.changed (updated) for the parent task', async () => {
      const { app, auth, emitted, reconcileCalls } = await setup();
      const res = await app.inject({ method: 'POST', url: '/subtasks', headers: auth, payload: { taskId: 't1', title: 'new' } });
      expect(res.statusCode).toBe(201);
      expect(emitted).toEqual([changed]);
      expect(reconcileCalls).toHaveLength(0);
    });

    it('PATCH /subtasks/:id emits task.changed (updated) for the parent task', async () => {
      const { app, auth, emitted, reconcileCalls } = await setup();
      const res = await app.inject({ method: 'PATCH', url: '/subtasks/sub-x', headers: auth, payload: { done: true } });
      expect(res.statusCode).toBe(200);
      expect(emitted).toEqual([changed]);
      expect(reconcileCalls).toHaveLength(0);
    });

    it('DELETE /subtasks/:id emits task.changed (updated) for the parent task', async () => {
      const { app, auth, emitted, reconcileCalls } = await setup();
      const res = await app.inject({ method: 'DELETE', url: '/subtasks/sub-x', headers: auth });
      expect(res.statusCode).toBe(204);
      expect(emitted).toEqual([changed]);
      expect(reconcileCalls).toHaveLength(0);
    });

    it('emits nothing when the subtask is not the caller\'s (404)', async () => {
      const { app, auth, emitted } = await setup();
      for (const req of [
        { method: 'POST' as const, url: '/subtasks', payload: { taskId: 'nope', title: 'x' } },
        { method: 'PATCH' as const, url: '/subtasks/nope', payload: { done: true } },
        { method: 'DELETE' as const, url: '/subtasks/nope' },
      ]) {
        const res = await app.inject({ ...req, headers: auth });
        expect(res.statusCode, req.method).toBe(404);
      }
      expect(emitted).toEqual([]);
    });
  });
});
